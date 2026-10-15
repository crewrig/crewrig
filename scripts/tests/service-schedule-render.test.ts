// service-schedule-render.test.ts — scripts/lib/service/schedule-{spec,render}.ts
// (spec 0258 requirement 15): the three pure renderers, weekly and daily.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderCalendarPlist,
  renderCalendarTaskXml,
  renderTimerPair,
} from "../lib/service/schedule-render.ts";
import { curatorNames } from "../lib/service/schedule-names.ts";
import { validateSchedule } from "../lib/service/schedule-spec.ts";
import type { ScheduleSpec } from "../lib/service/schedule-spec.ts";
import { classifyTask, expectationFromDefinition } from "../lib/service/task-ownership.ts";

const names = curatorNames();
const weekly: ScheduleSpec = {
  frequency: "weekly",
  hour: 9,
  nodePath: "/opt/node/bin/node",
  entry: "/repo/curate.ts",
  args: ["--apply", "--dedup", "--max-issues", "5"],
  pathValue: "/opt/node/bin:/usr/bin:/bin",
  logFile: "/srv/crewrig-test/.crewrig/curator.log",
};
const daily: ScheduleSpec = { ...weekly, frequency: "daily", hour: 17 };

test("plist, weekly: Monday weekday, hour, minute 0, PATH, no shell, no RunAtLoad", () => {
  const expected = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.crewrig.harness-curator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/node/bin/node</string>
        <string>/repo/curate.ts</string>
        <string>--apply</string>
        <string>--dedup</string>
        <string>--max-issues</string>
        <string>5</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/node/bin:/usr/bin:/bin</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/srv/crewrig-test/.crewrig/curator.log</string>
    <key>StandardErrorPath</key>
    <string>/srv/crewrig-test/.crewrig/curator.log</string>
</dict>
</plist>
`;
  const text = renderCalendarPlist(names, weekly);
  assert.equal(text, expected);
  assert.ok(!text.includes("bash") && !text.includes("RunAtLoad"));
});

test("plist, daily: no Weekday key; XML characters are escaped", () => {
  const text = renderCalendarPlist(names, {
    ...daily,
    args: ["--title", "a<b>&c"],
    pathValue: "/a&b:/c",
  });
  assert.ok(!text.includes("Weekday"));
  assert.match(text, /<key>Hour<\/key>\n\s+<integer>17<\/integer>\n\s+<key>Minute<\/key>/);
  assert.ok(text.includes("<string>a&lt;b&gt;&amp;c</string>"));
  assert.ok(text.includes("<string>/a&amp;b:/c</string>"));
});

test("timer pair, weekly: oneshot service and a Monday timer", () => {
  const { service, timer } = renderTimerPair(names, weekly);
  assert.equal(
    service,
    `[Unit]
Description=CrewRig scheduled job io.crewrig.harness-curator

[Service]
Type=oneshot
Environment="PATH=/opt/node/bin:/usr/bin:/bin"
ExecStart=/opt/node/bin/node /repo/curate.ts --apply --dedup --max-issues 5
StandardOutput=append:/srv/crewrig-test/.crewrig/curator.log
StandardError=append:/srv/crewrig-test/.crewrig/curator.log
`,
  );
  assert.equal(
    timer,
    `[Unit]
Description=CrewRig schedule of io.crewrig.harness-curator (weekly)

[Timer]
OnCalendar=Mon *-*-* 09:00:00
Persistent=false

[Install]
WantedBy=timers.target
`,
  );
});

test("timer pair, daily: every day at the hour", () => {
  const { timer } = renderTimerPair(names, { ...daily, hour: 0 });
  assert.ok(timer.includes("OnCalendar=*-*-* 00:00:00\n"));
  assert.ok(!timer.includes("Mon"));
});

test("timer pair: % is doubled, words with spaces or quotes are quoted", () => {
  const { service } = renderTimerPair(names, {
    ...weekly,
    nodePath: "/opt/my node/node",
    entry: "/repo/100%/curate.ts",
    args: ['say "hi"', "$HOME", "back\\slash"],
    pathValue: "/p%q:/bin",
    logFile: "/srv/crewrig-test/100%/curator.log",
  });
  assert.ok(service.includes('Environment="PATH=/p%%q:/bin"\n'));
  assert.ok(
    service.includes(
      'ExecStart="/opt/my node/node" /repo/100%%/curate.ts "say \\"hi\\"" $$HOME "back\\\\slash"\n',
    ),
  );
  assert.ok(service.includes("StandardOutput=append:/srv/crewrig-test/100%%/curator.log\n"));
});

test("task XML, weekly: Monday ScheduleByWeek and the settings of a calendar job", () => {
  const xml = renderCalendarTaskXml(names, weekly, "DOM\\user");
  const expected = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>crewrig:service-task \\CrewRig\\io.crewrig.harness-curator</Description>
    <URI>\\CrewRig\\io.crewrig.harness-curator</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <Enabled>true</Enabled>
      <StartBoundary>2000-01-03T09:00:00</StartBoundary>
      <ScheduleByWeek>
        <DaysOfWeek>
          <Monday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>DOM\\user</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>/opt/node/bin/node</Command>
      <Arguments>&quot;/repo/curate.ts&quot; --apply --dedup --max-issues 5</Arguments>
    </Exec>
  </Actions>
</Task>
`;
  assert.equal(xml, expected);
  assert.ok(!xml.includes("RestartOnFailure"));
});

test("task XML, daily: ScheduleByDay; quoting and XML escaping of arguments", () => {
  const xml = renderCalendarTaskXml(
    names,
    {
      ...daily,
      nodePath: "C:\\Program Files\\node\\node.exe",
      entry: "C:\\r e\\curate.ts",
      args: ["a b", "x<y"],
    },
    "u&v",
  );
  assert.ok(xml.includes("<StartBoundary>2000-01-01T17:00:00</StartBoundary>"));
  assert.ok(xml.includes("<ScheduleByDay>\n        <DaysInterval>1</DaysInterval>"));
  assert.ok(!xml.includes("ScheduleByWeek"));
  assert.ok(xml.includes("<UserId>u&amp;v</UserId>"));
  assert.ok(xml.includes("<Command>C:\\Program Files\\node\\node.exe</Command>"));
  assert.ok(
    xml.includes("<Arguments>&quot;C:\\r e\\curate.ts&quot; &quot;a b&quot; x&lt;y</Arguments>"),
  );
});

test("task XML is classified as the task's own by task-ownership.ts", () => {
  const xml = renderCalendarTaskXml(names, weekly, "DOM\\user");
  const expect = expectationFromDefinition(xml);
  assert.deepEqual(expect, { taskUri: names.taskPath, programPath: "/repo/curate.ts" });
  assert.ok(expect !== null);
  assert.deepEqual(classifyTask(xml, expect), { kind: "own" });
});

test("a task XML with a double quote in the interpreter or entry is refused", () => {
  for (const bad of [{ nodePath: '/n"ode' }, { entry: '/e"ntry.ts' }]) {
    assert.throws(() => renderCalendarTaskXml(names, { ...weekly, ...bad }, "u"), RangeError);
  }
  assert.throws(() => renderCalendarTaskXml(names, weekly, ""), RangeError);
  assert.throws(() => renderCalendarTaskXml(names, weekly, "u\nv"), RangeError);
});

test("hour bounds: 0 and 23 render, everything else is refused by every renderer", () => {
  for (const hour of [0, 23]) {
    const spec = { ...weekly, hour };
    assert.doesNotThrow(() => validateSchedule(spec));
    assert.ok(
      renderTimerPair(names, spec).timer.includes(`${String(hour).padStart(2, "0")}:00:00`),
    );
  }
  for (const hour of [-1, 24, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const spec = { ...weekly, hour };
    assert.throws(() => validateSchedule(spec), RangeError, String(hour));
    assert.throws(() => renderCalendarPlist(names, spec), RangeError);
    assert.throws(() => renderTimerPair(names, spec), RangeError);
    assert.throws(() => renderCalendarTaskXml(names, spec, "u"), RangeError);
  }
});

test("validateSchedule refuses relative paths, control characters and an unknown frequency", () => {
  const bad: Array<Partial<ScheduleSpec>> = [
    { nodePath: "node" },
    { entry: "curate.ts" },
    { logFile: "curator.log" },
    { nodePath: "" },
    { entry: "/a\nb.ts" },
    { logFile: "/a\u0000b" },
    { pathValue: "" },
    { pathValue: "/bin\n/usr/bin" },
    { args: ["--ok", "bad\narg"] },
    { args: ["bad\rarg"] },
    { frequency: "monthly" as unknown as ScheduleSpec["frequency"] },
  ];
  for (const patch of bad) {
    assert.throws(
      () => validateSchedule({ ...weekly, ...patch }),
      RangeError,
      JSON.stringify(patch),
    );
  }
  for (const ok of [
    "/usr/bin/node",
    "C:\\node\\node.exe",
    "C:/node/node.exe",
    "\\\\srv\\share\\n.exe",
  ]) {
    assert.doesNotThrow(() => validateSchedule({ ...weekly, nodePath: ok }), ok);
  }
});
