BeforeAll {
    . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Interop.ps1"; . "$PSScriptRoot\..\lib\Pump.ps1"; . "$PSScriptRoot\..\lib\Assets.ps1"; . "$PSScriptRoot\..\lib\Input.ps1"; . "$PSScriptRoot\..\lib\Model.ps1"; . "$PSScriptRoot\..\lib\Engine.ps1"
    function Act { param($m) $script:ran = $m.Name }
    function New-TestEngine {
        $script:calls = [System.Collections.ArrayList]::new(); $script:selected = 0; $script:ran = $null
        $keys = @((Key 'F13' 1 1), (Key 'F14' 1 2), (Key 'F15' 1 3))
        $layers = @((Layer 'A' (Icon 'chrome') @((Macro 'Act' 'M0'), '', (Macro { throw 'boom' } 'Bad'))), '', (Layer 'C' (Icon 'putty') @()))
        $layout = Layout (Key 'ScrollLock' 2 1 2 1) $keys $layers
        New-Engine $layout `
            -GetSelected { $script:selected } `
            -SelectLayer { param($i) [void]$script:calls.Add("select:$i"); if ($i -eq 2) { $script:selected = 2; $true } else { $false } } `
            -RunMacro { param($m) [void]$script:calls.Add("run:$($m.Name)"); Invoke-Macro $m } `
            -ShowOverlay { [void]$script:calls.Add('show') } -HideOverlay { [void]$script:calls.Add('hide') } `
            -OnError { param($m, $e) [void]$script:calls.Add("error:$($m.Name):$($e.Exception.Message)") }
    }
}
Describe 'Fn handling' {
    It 'enters mode 1 and shows the overlay, then hides on release' {
        $e = New-TestEngine
        Invoke-EngineFn $e; $e.Mode | Should -Be 1; $calls[-1] | Should -Be 'show'
        Invoke-EngineFnRelease $e; $e.Mode | Should -Be 0; $calls[-1] | Should -Be 'hide'
    }
}
Describe 'Invoke-EngineKey' {
    It 'selects layers in mode 1 and never runs macros' {
        $e = New-TestEngine; $e.Mode = 1
        Invoke-EngineKey $e 2; $calls | Should -Be @('select:2'); $e.Mode | Should -Be 1
    }
    It 'ignores blank layer in mode 1' {
        $e = New-TestEngine; $e.Mode = 1
        Invoke-EngineKey $e 1; $calls | Should -Be @('select:1'); $e.Mode | Should -Be 1; $selected | Should -Be 0
    }
    It 'runs the macro at the slot of the selected layer in mode 0' {
        $e = New-TestEngine; Invoke-EngineKey $e 0; $calls | Should -Be @('run:M0'); $ran | Should -Be 'M0'
    }
    It 'does nothing for a blank slot or a slot past the layer macros' {
        $e = New-TestEngine; Invoke-EngineKey $e 1; $script:selected = 2; Invoke-EngineKey $e 0; $calls.Count | Should -Be 0
    }
    It 'reports a throwing macro and keeps working' {
        $e = New-TestEngine
        Invoke-EngineKey $e 2; $calls[-1] | Should -Be 'error:Bad:boom'; $e.Mode | Should -Be 0
        Invoke-EngineKey $e 0; $calls[-1] | Should -Be 'run:M0'
    }
    It 'does nothing when the layout has no layers' {
        $e = New-TestEngine; $e.Layout = Layout (Key 'S') @((Key 'F13')) @('')
        Invoke-EngineKey $e 0; $calls.Count | Should -Be 0
    }
}
Describe 'Register-LayoutHotkeys' {
    BeforeAll {
        function New-FakeWindow([bool]$Result = $true, [bool]$HookResult = $true) {
            $w = [pscustomobject]@{
                Registered = [System.Collections.ArrayList]::new(); Hooked = $null; Context = $null
                Handler = $null; FnDownHandler = $null; FnUpHandler = $null; Result = $Result; HookResult = $HookResult
            }
            $w | Add-Member ScriptMethod Register { param($id, $mods, $vk) [void]$this.Registered.Add(@($id, $mods, $vk)); $this.Result }
            $w | Add-Member ScriptMethod HookFnKey { param($vk) $this.Hooked = $vk; $this.HookResult }
            $w | Add-Member ScriptMethod add_HotkeyPressed { param($h) $this.Handler = $h }
            $w | Add-Member ScriptMethod add_FnDown { param($h) $this.FnDownHandler = $h }
            $w | Add-Member ScriptMethod add_FnUp { param($h) $this.FnUpHandler = $h }
            $w
        }
    }
    It 'hooks Fn and registers keys by index with MOD_NOREPEAT' {
        $e = New-TestEngine; $w = New-FakeWindow
        Register-LayoutHotkeys $w $e.Layout $e
        $w.Hooked | Should -Be 0x91
        $w.Registered.Count | Should -Be 3
        $w.Registered[0] | Should -Be @(0, 0x4000, 0x7C); $w.Registered[2] | Should -Be @(2, 0x4000, 0x7E)
    }
    It 'routes Fn down/up and hotkey ids to the engine' {
        $e = New-TestEngine; $w = New-FakeWindow
        Register-LayoutHotkeys $w $e.Layout $e
        [object]::ReferenceEquals($w.Context.Engine, $e) | Should -BeTrue
        $w.FnDownHandler.Invoke($w, [System.EventArgs]::Empty); $e.Mode | Should -Be 1; $calls[-1] | Should -Be 'show'
        $w.Handler.Invoke($w, [pscustomobject]@{ Id = 2 }); $calls[-1] | Should -Be 'select:2'
        $w.FnUpHandler.Invoke($w, [System.EventArgs]::Empty); $e.Mode | Should -Be 0; $calls[-1] | Should -Be 'hide'
    }
    It 'throws naming the Fn key when the hook cannot be installed' {
        $e = New-TestEngine
        { Register-LayoutHotkeys (New-FakeWindow -HookResult $false) $e.Layout $e } | Should -Throw "Could not hook the Fn key 'ScrollLock'."
    }
    It 'throws naming the key when Register returns false' {
        $e = New-TestEngine
        { Register-LayoutHotkeys (New-FakeWindow $false) $e.Layout $e } | Should -Throw "Could not register hotkey 'F13'. Is the AutoHotkey macropad or another instance running?"
    }
}
Describe 'Invoke-EngineMacro guard' {
    It 'drops a macro key pressed while a macro is running' {
        $e = New-TestEngine; $script:eng = $e
        $e.Layout.Layers[0].Macros[1] = Macro { param($m) Invoke-EngineKey $script:eng 0 } 'Outer'
        Invoke-EngineKey $e 1
        $calls | Should -Be @('run:Outer'); $ran | Should -BeNullOrEmpty; $e.Busy | Should -BeFalse
    }
    It 'runs timer ticks but drops macros during a pumped wait' {
        $e = New-TestEngine
        $script:timer = New-Object System.Windows.Forms.Timer; $script:timer.Interval = 20; $script:timer.Tag = $e
        $script:timer.add_Tick({ param($sender, $a) $sender.Stop(); [void]$script:calls.Add('tick'); Invoke-EngineKey $sender.Tag 0 })
        $e.Layout.Layers[0].Macros[1] = Macro { param($m) $script:timer.Start(); Wait-Pump 200 } 'Waits'
        Invoke-EngineKey $e 1; $script:timer.Dispose()
        $calls | Should -Be @('run:Waits', 'tick')
    }
    It 'returns false when busy' { $e = New-TestEngine; $e.Busy = $true; Invoke-EngineMacro $e (Macro 'Act' 'M0') | Should -BeFalse; $calls.Count | Should -Be 0 }
    It 'clears Busy after a throwing macro' { $e = New-TestEngine; Invoke-EngineKey $e 2; $e.Busy | Should -BeFalse; $calls[-1] | Should -Be 'error:Bad:boom' }
    It 'does not report cancellation as an error' {
        $e = New-TestEngine
        $e.Layout.Layers[0].Macros[1] = Macro { throw [OperationCanceledException]::new('Macropad is exiting') } 'Cancelled'
        Invoke-EngineKey $e 1
        $calls | Should -Be @('run:Cancelled'); $e.Busy | Should -BeFalse
    }
}
