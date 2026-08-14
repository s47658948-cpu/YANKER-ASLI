YANKER — نسخه بدون Netlify Blobs

این نسخه برای راه‌اندازی سریع پنل ساخته شده و هیچ وابستگی به @netlify/blobs ندارد.

مهم:
ذخیره‌سازی این نسخه در حافظه Function است و با Restart/Deploy/Cold Start ممکن است درخواست‌ها و اعضا پاک شوند.
برای Production باید بعداً یک storage دائمی مثل Netlify Blobs با siteID/token یا یک دیتابیس اضافه شود.

Environment Variables:
ADMIN_USER=owner
ADMIN_PASSWORD=رمز پنل
SESSION_SECRET=یک رشته تصادفی طولانی

بعد از Deploy:
https://YOUR-SITE.netlify.app/.netlify/functions/api?action=health

باید storage=memory و persistentStorage=false را نشان دهد.
