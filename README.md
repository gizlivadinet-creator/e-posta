# Posta Yönlendirme Yöneticisi

GitHub Pages üzerinde çalışan, tamamen statik ve hafif bir **e-posta yönlendirme yönetim sistemi**. HTML5 + CSS3 + Vanilla JavaScript ile yazılmıştır. Harici bağımlılık, backend, DNS/MX/SPF/DKIM yapılandırması veya üçüncü taraf e-posta servisi kullanmaz.

## Dosyalar

| Dosya | Amaç |
|------|-----|
| `index.html` | Yönetim arayüzü ve yönlendirici (tek sayfa, sekmeli) |
| `style.css` | Responsive, modern, açık/koyu temalı stiller |
| `script.js` | Modüler uygulama mantığı (Storage, Log, Config, Rules, Router, UI) |
| `sw.js` | Service Worker — çevrimdışı önbellek |
| `cron.yml` | GitHub Actions iş akımı — günlük dosya/sözdizimi denetimi |
| `README.md` | Bu belge |

## Kurulum

1. Bu dosyaları bir GitHub deposuna yükleyin.
2. Repo ayarlarında **Settings → Pages** altında kaynak olarak `main` dalı ve `/ (root)` seçin.
3. Birkaç dakika içinde site `https://<kullanici>.github.io/<repo>/` adresinde yayına alınır.
4. `cron.yml`'i `.github/workflows/cron.yml` konumuna yerleştirin (opsiyonel, otomatik denetim için).

Kullanıcı arayüzü **Ayarlar** sekmesinden yapılandırılır. Değişiklikler seçilen saklama yöntemine göre (`localStorage` / `sessionStorage` / bellek) otomatik kaydedilir.

## Çalışma Mantığı

Sistem beş bölümden oluşur:

- **Kurallar** — Eşleşme deseni (`destek@*`, `*@satis.example`, `bilgi@kullanici.github.io`) ve hedef (`gerçek@adres.com`) içeren kurallar. Joker `*` destekler. Aç/kapat, düzenle, sil.
- **Ayarlar** — Kök alan adı, yönlendirici yolu, hız sınırı, sterilizasyon (XSS koruması), onay ekranı, varsayılan hedef, günlük saklama süresi, saklama yöntemi. Tek bölüm, otomatik kayıt.
- **Günlük** — Yönlendirme, hata ve yapılandırma olayları. Yalnızca tarayıcıda saklanır; belirtilen süreden eski kayıtlar otomatik silinir.
- **Yönlendirici** — Bir alıcı adresi girildiğinde kurallarla eşleştirir ve `mailto:` bağlantısına yönlendirir. "Bağlantıyı Kopyala" ile paylaşılabilir bir `/router?to=...` bağlantısı üretir.
- **Gönder** — Form verilerini [FormSubmit.co](https://formsubmit.co) AJAX uç noktasından `submissions@formsubmit.co` adresine (Ayarlar'dan değiştirilebilir) e-posta olarak iletir. Backend gerektirmeden gerçek e-posta teslimi sağlar.

### Mimari

```
Kullanıcı → index.html → script.js
                         ├─ Storage (localStorage/sessionStorage/bellek)
                         ├─ Config (tek ayar bölümü)
                         ├─ Rules (desen eşleştirme, joker *)
                         ├─ Router (hız sınırı, sterilizasyon, onay)
                         └─ Log (seviyeli, retention'lı)
                         ↓
                    sw.js (çevrimdışı önbellek)
```

Modüller (`Storage`, `Log`, `Config`, `Rules`, `Router`, `UI`) IIFE ile birbirinden ayrılmıştır; durum `module-level mutable global` yerine açık fonksiyon argümanlarıyla paylaşılır.

## Önemli Kısıtlamalar (Gerçekçi Sınırlar)

GitHub Pages **yalnızca statik dosya sunar**. Aşağıdakiler teknik olarak **mümkün değildir**:

- **SMTP sunucusu çalıştırmak** — Pages'e MX kaydı bağlanamaz; gelen e-posta kabul edilemez.
- **DNS/MX/SPF/DKIM/CNAME yapılandırmak** — Pages bu kayıtları kontrol etmez.
- **Cloudflare veya harici e-posta API'si kullanmak** — Kısıtlama bunu yasaklar.
- **Sunucu tarafı yönlendirme** — Çalışma zamanında backend yoktur.

**İstisna — FormSubmit.co:** Kullanıcının talebiyle, **Gönder** sekmesindeki form FormSubmit.co'un ücretsiz AJAX uç noktasına POST yapar ve verileri `submissions@formsubmit.co` adresine e-posta olarak iletir. Bu, GitHub Pages'in statik sınırını aşmak için kullanılan üçüncü taraf bir servis örneğidir; backend gerektirmez. İlk gönderimde FormSubmit hedef adresi aktivasyon e-postası gönderir. Hedef adres **Ayarlar** sekmesinden değiştirilebilir.

Bu nedenle bu sistem **gerçek e-posta iletimi yapmaz**. Bunun yerine, GitHub Pages sınırlarına uygun şu yaklaşımı sunar:

1. **Yönetim arayüzü** ile yönlendirme kurallarını oluşturma/saklama.
2. **Yönlendirici** ile `mailto:` bağlantıları üzerinden kullanıcının yerel e-posta istemcisini açma.
3. **Paylaşılabilir bağlantılar** (`/router?to=...`) ile kurallara göre yönlendirme.
4. **Günlük ve yedekleme** (dışa/içe aktarma) ile yönetilebilirlik.

Gerçek SMTP iletme gerekirse: Pages dışında bir sunucu (örn. bir Edge Function veya kendi VPS'iniz) gerekir; bu, bu projenin kapsamı dışındadır.

## Güvenlik

- Hedef adresler opsiyonel sterilizasyondan geçer (`<`, `>`, `"`, `'`, `` ` `` filtrelenir).
- `mailto:` dışında protokol kabul edilmez.
- Hız sınırı (saniye/maksimum) ile kötüye kullanım azaltılır.
- Tüm veriler tarayıcıda saklanır; sunucuya hiçbir şey gönderilmez.

## Lisans

Kamu malı / CC0. İstediğiniz gibi kullanın.
