# API Endpoints

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| `POST` | `/upload` | دریافت فایل `multipart/form-data` و ذخیره‌ی نسخه‌ی اصلی + thumbnail. | `Bearer <JWT>` الزامی |
| `GET` | `/media/:sha/meta` | بازگرداندن متادیتا و مسیرهای ذخیره‌سازی برای شیء با SHA داده‌شده. | اختیاری (قابل تنظیم) |
| `GET` | `/health` | وضعیت سرویس و آماده بودن وابستگی‌ها. (اختیاری برای مانیتورینگ) | بدون نیاز به Auth |

> توجه: سرویس هیچ فایل دودویی‌ای را سرو نمی‌کند؛ برای دسترسی به فایل‌ها باید مستقیماً به Nginx یا CDN متصل شوید:  
> - Originals: `/o/{yyyy}/{mm}/{dd}/{sha}.{ext}`  
> - Thumbnails: `/t/{yyyy}/{mm}/{dd}/{sha}.jpg`
