import os
import re
import sys
from datetime import datetime

try:
    from mempalace.mcp_server import tool_list_drawers, tool_delete_drawer
except ImportError as e:
    print(f"Error: Failed to import mempalace: {e}", file=sys.stderr)
    print(
        f"  Ensure MemPalace is installed: pipx install '{os.environ['MEMPALACE_INSTALL_SPEC']}'",
        file=sys.stderr,
    )
    sys.exit(2)

wing = os.environ["TRANSCRIPTS_WING"]
project_filter = os.environ.get("PROJECT_FILTER", "")
cutoff_date = os.environ["CUTOFF_DATE"]
dry_run = os.environ["DRY_RUN"].lower() == "true"

# Parse cutoff date once
try:
    cutoff_dt = datetime.strptime(cutoff_date, "%Y-%m-%d")
except ValueError:
    print(f"Error: Invalid cutoff date format: {cutoff_date}", file=sys.stderr)
    sys.exit(2)

# Pagination configuration
PAGE_SIZE = 100
MAX_TOTAL_DRAWERS = 50000  # Safety cap to avoid runaway
total_drawers_seen = 0
offset = 0

# Track statistics
stats = {
    "total_scanned": 0,
    "skipped_format": 0,
    "skipped_filter": 0,
    "aged_out": 0,
}

# List drawers with pagination
to_delete = []

while total_drawers_seen < MAX_TOTAL_DRAWERS:
    list_result = tool_list_drawers(wing=wing, limit=PAGE_SIZE, offset=offset)
    
    # tool_list_drawers returns {drawers, count, offset, limit} — no 'success' key
    drawers = list_result.get("drawers", [])
    
    if not drawers:
        break
    
    total_drawers_seen += len(drawers)
    
    for drawer in drawers:
        stats["total_scanned"] += 1
        drawer_id = drawer.get("drawer_id")
        room = drawer.get("room")
        
        # Skip if room format doesn't exist
        if not room:
            stats["skipped_format"] += 1
            continue
        
        # Parse room name with regex: <project>-<date>-<sid>
        # Date format is YYYY-MM-DD (contains hyphens)
        # Session ID is 8 hex chars
        match = re.match(
            r"^(?P<project>.+)-(?P<date>\d{4}-\d{2}-\d{2})-(?P<sid>[a-f0-9]{8})$",
            room
        )
        
        if not match:
            stats["skipped_format"] += 1
            continue
        
        project_name = match.group("project")
        date_str = match.group("date")
        
        # Apply project filter if set
        if project_filter and project_name != project_filter:
            stats["skipped_filter"] += 1
            continue
        
        # Parse date string
        try:
            drawer_dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            stats["skipped_format"] += 1
            continue
        
        # Check if drawer is older than cutoff
        if drawer_dt < cutoff_dt:
            stats["aged_out"] += 1
            to_delete.append((drawer_id, room, drawer_dt))
    
    # Check if we've processed all drawers
    if len(drawers) < PAGE_SIZE:
        break
    
    offset += PAGE_SIZE

print(f"Scanned: {stats['total_scanned']} drawer(s)")
print(f"Format mismatch: {stats['skipped_format']}")
if project_filter:
    print(f"Filtered by project: {stats['skipped_filter']}")
print(f"Aged out (older than {cutoff_date}): {stats['aged_out']}")
print(f"Eligible for deletion: {len(to_delete)}")
print()

# Escalate if all drawers were skipped due to format mismatch
if stats["total_scanned"] > 0 and stats["skipped_format"] == stats["total_scanned"]:
    print("Error: All scanned drawers failed room-name format validation.", file=sys.stderr)
    print("  This suggests the wing contains rooms not matching <project>-<date>-<sid>.", file=sys.stderr)
    print("  If you renamed or changed the transcript room format, this script needs updates.", file=sys.stderr)
    sys.exit(3)

if not to_delete:
    print("No drawers to delete.")
    sys.exit(0)

if dry_run:
    print("DRY RUN - would delete:")
    for drawer_id, room, drawer_dt in to_delete:
        print(f"  - {room} (id={drawer_id}, date={drawer_dt.strftime('%Y-%m-%d')})")
else:
    deleted_count = 0
    failed_count = 0
    for drawer_id, room, drawer_dt in to_delete:
        delete_result = tool_delete_drawer(drawer_id=drawer_id)
        # tool_delete_drawer *does* return {success, error}
        if delete_result.get("success"):
            print(f"Deleted: {room} (id={drawer_id}, date={drawer_dt.strftime('%Y-%m-%d')})")
            deleted_count += 1
        else:
            print(f"Failed to delete {room} (id={drawer_id}): {delete_result.get('error', 'unknown')}", file=sys.stderr)
            failed_count += 1
    
    print()
    print(f"Deleted: {deleted_count} drawer(s)")
    if failed_count > 0:
        print(f"Failed: {failed_count} drawer(s)", file=sys.stderr)
        sys.exit(4)
