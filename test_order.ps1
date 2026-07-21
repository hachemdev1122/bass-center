$body = '{"customer_name":"test user","phone":"07801234567","governorate":"Baghdad","address_detail":"test street","product_id":1,"quantity":1,"notes":"test order"}'

$headers = @{
    "Content-Type" = "application/json"
}

Invoke-RestMethod -Uri "https://bass-center.vercel.app/api/orders" -Method POST -Headers $headers -Body $body
