#!/bin/sh
# Backend entrypoint: run migrations then start uvicorn.
#
# If the database is ahead of this image (a migration was applied directly but
# the image hasn't been rebuilt yet), the server starts with a warning instead
# of crash-looping. This is safe for non-breaking additive changes (new columns
# with server defaults). Rebuild the image to fully resolve the mismatch.

echo "[agentfloor] Running database migrations..."
ALEMBIC_OUT=$(alembic upgrade head 2>&1)
ALEMBIC_RC=$?

echo "$ALEMBIC_OUT"

if [ "$ALEMBIC_RC" -ne 0 ]; then
    if echo "$ALEMBIC_OUT" | grep -q "Can't locate revision identified by"; then
        echo ""
        echo "[agentfloor] WARNING: Database has a migration revision not present in this image."
        echo "[agentfloor] Non-breaking schema changes (added columns with defaults) are safe to run through."
        echo "[agentfloor] Run 'docker compose up -d --build backend' when convenient to fully sync."
        echo "[agentfloor] Starting server anyway..."
    else
        echo ""
        echo "[agentfloor] ERROR: Migration failed — see output above. Aborting."
        exit 1
    fi
fi

echo ""
exec uvicorn main:app --host 0.0.0.0 --port 8000
