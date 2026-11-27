# 只读采集以薯换福好友票据：扫 QQ 渲染进程内存里的明文票据消息，输出 JSON。
# 依赖：Windows + QQ 农场小程序正在运行（用户打开过好友铺子）。
# 只读：OpenProcess(0x0410) / ReadProcessMemory / VirtualQueryEx / CloseHandle。
param([int]$MaxMsPerProcess = 20000)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class SweetTicketHarvest {
    [StructLayout(LayoutKind.Sequential)]
    struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public int AllocationProtect; public IntPtr RegionSize; public int State; public int Protect; public int Type; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int a, bool i, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
    [DllImport("kernel32.dll", SetLastError = true)] static extern int VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, int len);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    public static string Harvest(int pid, int maxMs) {
        var sb = new StringBuilder();
        IntPtr h = OpenProcess(0x0410, false, pid);
        if (h == IntPtr.Zero) return "";
        var pairs = new HashSet<string>();
        var sw = Stopwatch.StartNew();
        IntPtr addr = IntPtr.Zero; MBI mbi = new MBI();
        int mbiSize = Marshal.SizeOf(typeof(MBI));
        while (VirtualQueryEx(h, addr, out mbi, mbiSize) != 0) {
            long size = mbi.RegionSize.ToInt64();
            int prot = mbi.Protect & 0xFF;
            if (mbi.State == 0x1000 && (prot == 0x02 || prot == 0x04 || prot == 0x08 || prot == 0x20 || prot == 0x40) && size > 0 && size <= 64L * 1024 * 1024) {
                byte[] buf = new byte[(int)size]; IntPtr read;
                if (ReadProcessMemory(h, mbi.BaseAddress, buf, (int)size, out read)) {
                    int limit = buf.Length - 48;
                    for (int i = 0; i <= limit; i++) {
                        if (buf[i] != 0x08) continue;
                        int j = i + 1; ulong act; int sh = 0;
                        if (!Varint(buf, ref j, out act, ref sh)) continue;
                        if (act < 100000) continue;
                        if (j >= buf.Length || buf[j] != 0x10) continue;
                        j++; sh = 0; ulong gid;
                        if (!Varint(buf, ref j, out gid, ref sh)) continue;
                        if (gid < 100000 || gid > 99999999999UL) continue;
                        if (j + 1 >= buf.Length || buf[j] != 0x1a || buf[j + 1] != 0x24) continue;
                        int off = j + 2;
                        if (off + 36 > buf.Length) continue;
                        string uuid = Encoding.ASCII.GetString(buf, off, 36);
                        if (!IsUuid(uuid)) continue;
                        pairs.Add(act + "|" + gid + "|" + uuid);
                    }
                }
            }
            long next = mbi.BaseAddress.ToInt64() + size;
            if (next <= addr.ToInt64()) break;
            addr = new IntPtr(next);
            if (sw.ElapsedMilliseconds > maxMs) break;
        }
        CloseHandle(h);
        foreach (var p in pairs) sb.Append(p).Append('\n');
        return sb.ToString();
    }
    static bool Varint(byte[] b, ref int i, out ulong v, ref int shift) {
        v = 0; shift = 0;
        while (i < b.Length) { byte x = b[i++]; v |= (ulong)(x & 0x7F) << shift; if ((x & 0x80) == 0) return true; shift += 7; if (shift > 63) return false; }
        return false;
    }
    static bool IsUuid(string s) {
        if (s.Length != 36) return false;
        for (int i = 0; i < 36; i++) { char c = s[i];
            if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
            else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false; }
        return true;
    }
}
'@
$procs = @(Get-CimInstance Win32_Process -Filter "Name='QQ.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '--type=renderer' -and $_.CommandLine -match 'QQEX' })
$all = New-Object System.Collections.Generic.HashSet[string]
foreach ($p in $procs) {
    $out = [SweetTicketHarvest]::Harvest([int]$p.ProcessId, $MaxMsPerProcess)
    foreach ($line in ($out -split "`n")) { if ($line.Trim()) { [void]$all.Add($line.Trim()) } }
}
$rows = @()
foreach ($item in $all) {
    $parts = $item -split '\|'
    if ($parts.Count -eq 3) { $rows += [pscustomobject]@{ activity = $parts[0]; gid = $parts[1]; ticket = $parts[2] } }
}
@{ found = $rows.Count; tickets = $rows } | ConvertTo-Json -Depth 4 -Compress