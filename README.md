# Bass Center - متجر الموبايلات

## النشر على Railway

1. ارفع المشروع على GitHub
2. سجل دخول على [railway.app](https://railway.app)
3. اضغط "New Project" → "Deploy from GitHub"
4. اختر المشروع
5. Railway بيشتغل تلقائياً

## النشر على Render

1. ارفع المشروع على GitHub
2. سجل دخول على [render.com](https://render.com)
3. اضغط "New" → "Web Service"
4. اختر المشروع
5. اضبط الإعدادات:
   - Build Command: `npm install`
   - Start Command: `npm start`

## الإعدادات

بعد النشر، افتح لوحة التحكم:
```
https://your-app-name.up.railway.app/admin
```

كلمة المرور: `admin123`

## ملاحظات مهمة

- المنتجات والطلبات تُحفظ بقاعدة بيانات محلية
- عند النشر على Railway، قد تُحذف البيانات عند إعادة التشغيل
- للإنتاج الفعلي، يُفضل استخدام قاعدة بيانات خارجية
