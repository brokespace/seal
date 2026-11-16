// Holds a terminal pane's foreground as `claude`, so its hook rows are not dropped as an exited agent's.
process.title = 'claude'
process.stdin.resume()
process.stdout.write('SEAL_E2E_CLAUDE_PROCESS_READY\r\n')
