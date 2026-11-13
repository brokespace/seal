import { describe, expect, it } from 'vitest'
import { decodeRemotePowerShellScript } from '../../ssh/remote-exec/ssh-remote-powershell'
import {
  parseWindowsContentLength,
  windowsDownloadUrlCommand
} from '../filesystem/windows-machine-commands'
import { parseWindowsMachineMetrics } from './windows-machine-metrics'

describe('Windows SSH machine stats', () => {
  it('reads the marked PowerShell line and ignores profile noise around it', () => {
    const output = [
      'Welcome to the GPU lab',
      'SEAL_METRICS {"hostname":"KESSEL-WIN","caption":"Microsoft Windows 11 Pro","version":"10.0.22631","arch":"AMD64","cpus":16,"cpuModel":"AMD Ryzen 9 7950X 16-Core Processor","cpuPercent":37,"memTotalKb":67108864,"memFreeKb":16777216,"diskTotal":2000397791232,"diskFree":500099447808,"diskMount":"C:","uptime":93784,"home":"C:\\\\Users\\\\brian"}',
      ''
    ].join('\r\n')

    expect(parseWindowsMachineMetrics(output, 42)).toEqual({
      hostname: 'KESSEL-WIN',
      os: 'win32',
      osRelease: '11 Pro',
      arch: 'x86_64',
      cpuCount: 16,
      cpuModel: 'AMD Ryzen 9 7950X 16-Core Processor',
      loadAverage: null,
      cpuUsagePercent: 37,
      memTotalBytes: 68_719_476_736,
      memAvailableBytes: 17_179_869_184,
      diskTotalBytes: 2_000_397_791_232,
      diskAvailableBytes: 500_099_447_808,
      diskMount: 'C:',
      uptimeSeconds: 93_784,
      homeDir: 'C:\\Users\\brian',
      collectedAt: 42
    })
  })

  it('still reports a Windows host when PowerShell printed nothing usable', () => {
    const metrics = parseWindowsMachineMetrics("'powershell.exe' is not recognized", 7)

    expect(metrics.os).toBe('win32')
    expect(metrics.memTotalBytes).toBeNull()
    expect(metrics.cpuUsagePercent).toBeNull()
  })
})

describe('Windows SSH URL download', () => {
  it('writes to the native path of the SFTP destination, quoting it for PowerShell', () => {
    const script = decodeRemotePowerShellScript(
      windowsDownloadUrlCommand(
        "https://example.com/brian's model.bin",
        "/C:/Users/brian/it's here/model.bin"
      )
    )

    expect(script).toContain(
      "Invoke-WebRequest -UseBasicParsing -Uri 'https://example.com/brian''s model.bin' -OutFile 'C:/Users/brian/it''s here/model.bin'"
    )
  })

  it('reads Content-Length from the marked line only', () => {
    expect(parseWindowsContentLength('banner 99\r\nSEAL_LENGTH 1048576\r\n')).toBe(1_048_576)
    expect(parseWindowsContentLength('SEAL_LENGTH \r\n')).toBeNull()
  })
})
