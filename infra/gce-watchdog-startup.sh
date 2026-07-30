#!/bin/bash
set -e

APP_URL="https://smart-notes-hub-651554012781.us-central1.run.app"

cat <<EOF > /usr/local/bin/watchdog.sh
#!/bin/bash
STATUS=\$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL/health")
echo "\$(date -u) health=\$STATUS" >> /var/log/smart-notes-hub-watchdog.log
EOF
chmod +x /usr/local/bin/watchdog.sh

cat <<'EOF' > /etc/systemd/system/smart-notes-watchdog.service
[Unit]
Description=Smart Notes Hub Cloud Run health watchdog

[Service]
ExecStart=/usr/local/bin/watchdog.sh
EOF

cat <<'EOF' > /etc/systemd/system/smart-notes-watchdog.timer
[Unit]
Description=Run Smart Notes Hub watchdog every 15 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now smart-notes-watchdog.timer
