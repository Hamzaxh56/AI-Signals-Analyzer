RENDER DEPLOYMENT FIX

1. Extract this ZIP.
2. Upload ALL extracted files and folders to the ROOT of the GitHub repository connected to Render.
3. Confirm app.py, setup.py, requirements.txt, .python-version, render.yaml, static/ and quotexpy/ are at the same root level.
4. Confirm quotexpy/__init__.py exists and is not empty.
5. Commit changes, then Render > Manual Deploy > Deploy latest commit.

Build command: pip install -r requirements.txt
Start command: gunicorn --bind 0.0.0.0:$PORT app:app

This fixes local package installation only. It does not guarantee Quotex connection or OTC data availability. No simulated candles should be used; show WAIT when fresh verified data is unavailable.
