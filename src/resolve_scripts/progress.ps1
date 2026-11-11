# The small progress window VaultHub shows over DaVinci Resolve while it works. Started by common.lua.
param([string]$Port, [string]$Token, [string]$Id, [string]$Title)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$url = "http://127.0.0.1:$Port"
$headers = @{ "X-Lelons-Token" = $Token }
function Ask($path) {
  try { Invoke-RestMethod -Method Post -Uri ($url + $path) -Headers $headers -ContentType "application/json" `
          -Body ('{"id":"' + $Id + '"}') -TimeoutSec 5 } catch { $null }
}

$dark = [System.Drawing.Color]::FromArgb(28, 28, 30)
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.ClientSize = New-Object System.Drawing.Size(420, 130)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.BackColor = $dark
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(18, 16)
$label.Size = New-Object System.Drawing.Size(384, 40)
$label.Text = "Starting..."
$form.Controls.Add($label)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(18, 60)
$bar.Size = New-Object System.Drawing.Size(384, 14)
$bar.Maximum = 100
$bar.Style = "Marquee"
$form.Controls.Add($bar)

$button = New-Object System.Windows.Forms.Button
$button.Text = "Cancel"
$button.Location = New-Object System.Drawing.Point(312, 88)
$button.Size = New-Object System.Drawing.Size(90, 30)
$button.FlatStyle = "Flat"
$button.BackColor = [System.Drawing.Color]::FromArgb(44, 44, 46)
$form.Controls.Add($button)

$script:closing = 0
$button.Add_Click({
  if ($button.Text -eq "Cancel") {
    $label.Text = "Stopping..."
    $button.Enabled = $false
    $state = Ask "/api/resolve-job"
    if ($state -and $state.status -eq "checking") { Ask "/api/rt-remove" | Out-Null } else { Ask "/api/rt-cancel" | Out-Null }
  } else { $form.Close() }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.Add_Tick({
  if ($script:closing -gt 0) { $script:closing--; if ($script:closing -eq 0) { $form.Close() }; return }
  $state = Ask "/api/resolve-job"
  if (-not $state) { $form.Close(); return }
  $status = [string]$state.status
  $percent = [int][math]::Floor([double]("0" + $state.progress))
  if ($status -eq "active" -and $percent -gt 0) {
    $bar.Style = "Continuous"; $bar.Value = [math]::Min(100, $percent)
  } elseif ($status -eq "checking" -or $status -eq "done") {
    $bar.Style = "Continuous"; $bar.Value = 100
  }
  if ($status -eq "checking") {
    $label.Text = "Done listening! Check the words in VaultHub, then click ""Put in Resolve""."
  } elseif ($status -eq "done") {
    $label.Text = "Putting it in Resolve..."; $button.Enabled = $false; $script:closing = 3
  } elseif ($status -eq "error" -or $status -eq "gone") {
    $form.Close()
  } elseif ($state.message) {
    $label.Text = [string]$state.message
  }
})
$form.Add_Shown({ $form.Activate(); $timer.Start() })
[void]$form.ShowDialog()
