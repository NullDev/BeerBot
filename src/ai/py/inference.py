import sys, json, signal
from inference_core import generate

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

running = True
def handle_sigterm(signum, frame):
    global running
    running = False

signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigterm)

while running:
    line = sys.stdin.readline()
    if not line:
        break # stdin closed -> graceful exit

    try:
        req = json.loads(line)
        text = req.get("text", "").strip()

        if not text:
            sys.stdout.write(json.dumps({"ok": True, "result": "", "parrot": False}) + "\n")
            sys.stdout.flush()
            continue

        from inference_core import generate
        result = generate(text)

        sys.stdout.write(json.dumps({"ok": True, "result": result["text"], "parrot": result["parrot"]}) + "\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\n")
        sys.stdout.flush()

sys.exit(0)
