$body = @{
    telegram_bot_token = "8856509980:AAGMdfoXgqZOuOYMms3E7ZBTFhQDDx-goYs"
    telegram_chat_id = "597044471,5003037996"
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
    "X-Admin-Token" = "alishehab"
}

Invoke-RestMethod -Uri "https://bass-center.vercel.app/api/admin/settings" -Method PUT -Headers $headers -Body $body
