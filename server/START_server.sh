#!/bin/bash
IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
echo "Server will start at https://$IP:8000"
uvicorn main:app \
  --host 0.0.0.0 --port 8000 \
  --ssl-keyfile "permissions/$IP+2-key.pem" \
  --ssl-certfile "permissions/$IP+2.pem"