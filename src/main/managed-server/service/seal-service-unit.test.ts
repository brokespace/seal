import { describe, expect, it } from 'vitest'
import { renderSealServiceLaunchAgent, renderSealServiceSystemdUnit } from './seal-service-unit'

describe('the managed launcher as a service', () => {
  it('renders a systemd user unit that runs only the stable launcher', () => {
    expect(renderSealServiceSystemdUnit('/home/dev/.orca-remote')).toBe(`[Unit]
Description=Seal server (managed over SSH)
StartLimitIntervalSec=900
StartLimitBurst=5

[Service]
Type=simple
ExecStart=/home/dev/.orca-remote/bin/seal-server
Restart=on-failure
RestartSec=10
TimeoutStopSec=90
KillMode=process

[Install]
WantedBy=default.target
`)
  })

  it('quotes a managed root systemd would split or expand', () => {
    expect(renderSealServiceSystemdUnit('/home/a b/100%/.orca-remote/')).toContain(
      '\nExecStart="/home/a b/100%%/.orca-remote/bin/seal-server"\n'
    )
  })

  it('renders a launchd agent that leaves the server’s children alone', () => {
    expect(renderSealServiceLaunchAgent('/Users/dev & co/.orca-remote'))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.brokespace.seal.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/dev &amp; co/.orca-remote/bin/seal-server</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ExitTimeOut</key>
  <integer>90</integer>
  <key>StandardOutPath</key>
  <string>/Users/dev &amp; co/.orca-remote/bin/seal-server.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/dev &amp; co/.orca-remote/bin/seal-server.log</string>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`)
  })
})
