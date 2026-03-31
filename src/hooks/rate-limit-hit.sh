#!/bin/bash
# Fires when Claude Code hits a rate limit - sends urgent Windows notification

powershell -NoProfile -Command "
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    \$template = '<toast duration=\"long\"><visual><binding template=\"ToastGeneric\"><text>Claude Rate Limit Hit!</text><text>You have been rate-limited. Wait for the limit to reset before continuing.</text></binding></visual><audio src=\"ms-winsoundevent:Notification.Reminder\"/></toast>'

    \$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    \$xml.LoadXml(\$template)
    \$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    \$toast = [Windows.UI.Notifications.ToastNotification]::new(\$xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(\$appId).Show(\$toast)
  } catch {
    Add-Type -AssemblyName System.Windows.Forms
    \$n = New-Object System.Windows.Forms.NotifyIcon
    \$n.Icon = [System.Drawing.SystemIcons]::Error
    \$n.Visible = \$true
    \$n.ShowBalloonTip(10000, 'Claude Rate Limit Hit!', 'You have been rate-limited. Wait for reset.', 'Error')
    Start-Sleep -Seconds 11
    \$n.Dispose()
  }
"
