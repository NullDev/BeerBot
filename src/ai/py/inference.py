import sys, json
import numpy as np
from inference_core import generate

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

for line in sys.stdin:
    try:
        req = json.loads(line)
        text = req.get("text", "").strip()

        if not text:
            sys.stdout.write(json.dumps({"ok": True, "result": ""}) + "\n")
            sys.stdout.flush()
            continue

        # 10% chance sample, 90% beam
        if np.random.rand() < 0.1:
            result = generate(text, method="sample")
            method = "sample"
        else:
            result = generate(text, method="beam")
            method = "beam"

        sys.stdout.write(json.dumps({"ok": True, "result": result, "method": method}) + "\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\n")
        sys.stdout.flush()
