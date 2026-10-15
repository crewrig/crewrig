// schedule-render.ts — PURE renderers of the calendar-triggered job of the
// service layer (spec 0258 requirement 15; PLAN v2 step 16): a launchd plist, a
// systemd `.service` + `.timer` pair and a Task Scheduler XML. No file is read or
// written and nothing is spawned; the caller writes the text (the Task Scheduler
// XML is encoded with `encodeUtf16le`). Every renderer validates the spec first.
//
// There is no `bash -lc` and no `RunAtLoad`/`Restart`: the job fires on its
// calendar only, runs `<nodePath> <entry> <args>` and carries the installer's PATH.

import type { ScheduleNames } from "./schedule-names.ts";
import { validateSchedule } from "./schedule-spec.ts";
import type { ScheduleSpec } from "./schedule-spec.ts";
import { TASK_MARKER, quoteArg, xmlEscape } from "./windows-task-xml.ts";

const hh = (hour: number): string => String(hour).padStart(2, "0");

// ---- launchd ---------------------------------------------------------------

const str = (value: string, indent: string): string =>
  `${indent}<string>${xmlEscape(value)}</string>`;

/** The launchd agent plist: `StartCalendarInterval` (Weekday 1 only for weekly), no `RunAtLoad`. */
export function renderCalendarPlist(names: ScheduleNames, spec: ScheduleSpec): string {
  validateSchedule(spec);
  const interval = [
    ...(spec.frequency === "weekly"
      ? ["        <key>Weekday</key>", "        <integer>1</integer>"]
      : []),
    "        <key>Hour</key>",
    `        <integer>${spec.hour}</integer>`,
    "        <key>Minute</key>",
    "        <integer>0</integer>",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "    <key>Label</key>",
    str(names.label, "    "),
    "    <key>ProgramArguments</key>",
    "    <array>",
    ...[spec.nodePath, spec.entry, ...spec.args].map((word) => str(word, "        ")),
    "    </array>",
    "    <key>EnvironmentVariables</key>",
    "    <dict>",
    "        <key>PATH</key>",
    str(spec.pathValue, "        "),
    "    </dict>",
    "    <key>StartCalendarInterval</key>",
    "    <dict>",
    ...interval,
    "    </dict>",
    "    <key>StandardOutPath</key>",
    str(spec.logFile, "    "),
    "    <key>StandardErrorPath</key>",
    str(spec.logFile, "    "),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

// ---- systemd ---------------------------------------------------------------

const SAFE_WORD_RE = /^[A-Za-z0-9_@+=:,./%$-]+$/;

/** `%` and `$` doubled (specifiers and variables); quoted when it is not one plain word. */
function execWord(word: string): string {
  const doubled = word.replaceAll("%", "%%").replaceAll("$", "$$$$");
  if (SAFE_WORD_RE.test(doubled)) return doubled;
  return `"${doubled.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export interface TimerPair {
  /** The text of `<unit>.service`. */
  readonly service: string;
  /** The text of `<unit>.timer`. */
  readonly timer: string;
}

/** A `Type=oneshot` service and the `.timer` that fires it; the `.timer` is the unit to enable. */
export function renderTimerPair(names: ScheduleNames, spec: ScheduleSpec): TimerPair {
  validateSchedule(spec);
  const percent = (text: string): string => text.replaceAll("%", "%%");
  const env = `PATH=${spec.pathValue}`.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const log = `append:${percent(spec.logFile)}`;
  const service = [
    "[Unit]",
    `Description=CrewRig scheduled job ${percent(names.unit)}`,
    "",
    "[Service]",
    "Type=oneshot",
    `Environment="${percent(env)}"`,
    `ExecStart=${[spec.nodePath, spec.entry, ...spec.args].map(execWord).join(" ")}`,
    `StandardOutput=${log}`,
    `StandardError=${log}`,
    "",
  ].join("\n");
  const calendar =
    spec.frequency === "weekly"
      ? `Mon *-*-* ${hh(spec.hour)}:00:00`
      : `*-*-* ${hh(spec.hour)}:00:00`;
  const timer = [
    "[Unit]",
    `Description=CrewRig schedule of ${percent(names.unit)} (${spec.frequency})`,
    "",
    "[Timer]",
    `OnCalendar=${calendar}`,
    "Persistent=false",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  return { service, timer };
}

// ---- Task Scheduler --------------------------------------------------------

/** A task path or user id may not hold a control character; the XML escaping does the rest. */
function checkXmlText(label: string, value: string): void {
  if (value === "" || /[\u0000-\u001f]/.test(value)) {
    throw new RangeError(`invalid ${label}: ${JSON.stringify(value)}`);
  }
}

/**
 * The Task Scheduler XML (text; the caller encodes it with `encodeUtf16le`). The
 * Description carries `crewrig:service-task <URI>` so `task-ownership.ts`
 * classifies it. The interpreter and entry paths may not hold a double quote:
 * the entry is always quoted in `Arguments`, as in the daemon templates.
 */
export function renderCalendarTaskXml(
  names: ScheduleNames,
  spec: ScheduleSpec,
  userId: string,
): string {
  validateSchedule(spec);
  checkXmlText("user id", userId);
  checkXmlText("task path", names.taskPath);
  for (const [label, value] of [
    ["node path", spec.nodePath],
    ["entry", spec.entry],
  ] as const) {
    if (value.includes('"')) throw new RangeError(`invalid ${label}: ${JSON.stringify(value)}`);
  }
  const user = xmlEscape(userId);
  const uri = xmlEscape(names.taskPath);
  const trigger =
    spec.frequency === "weekly"
      ? [
          "      <StartBoundary>2000-01-03T" + hh(spec.hour) + ":00:00</StartBoundary>",
          "      <ScheduleByWeek>",
          "        <DaysOfWeek>",
          "          <Monday />",
          "        </DaysOfWeek>",
          "        <WeeksInterval>1</WeeksInterval>",
          "      </ScheduleByWeek>",
        ]
      : [
          "      <StartBoundary>2000-01-01T" + hh(spec.hour) + ":00:00</StartBoundary>",
          "      <ScheduleByDay>",
          "        <DaysInterval>1</DaysInterval>",
          "      </ScheduleByDay>",
        ];
  const args = [`"${spec.entry}"`, ...spec.args.map(quoteArg)].join(" ");
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${TASK_MARKER} ${uri}</Description>`,
    `    <URI>${uri}</URI>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <CalendarTrigger>",
    "      <Enabled>true</Enabled>",
    ...trigger,
    "    </CalendarTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${user}</UserId>`,
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <AllowHardTerminate>true</AllowHardTerminate>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    "    <Hidden>true</Hidden>",
    "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
    "    <WakeToRun>false</WakeToRun>",
    "    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>",
    "    <Priority>7</Priority>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${xmlEscape(spec.nodePath)}</Command>`,
    `      <Arguments>${xmlEscape(args)}</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\n");
}
