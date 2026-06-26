# Writer Tracker — เครื่องนับคำ & ติดตามการเขียน

เว็บแอปฝั่ง browser ล้วน สำหรับเขียนงาน นับจำนวนคำภาษาไทยอัตโนมัติ ดูสถิติรายวัน และซิงค์กับ Google Docs/Sheets

## ฟีเจอร์

**เฟส 1 (ทำงานได้เลย ไม่ต้องตั้งค่าอะไร)**
- ✅ กล่องเขียน + **ตัวหนา** (ปุ่ม B หรือ Ctrl+B)
- ✅ นับคำภาษาไทย realtime (`Intl.Segmenter`)
- ✅ Dashboard สถิติรายวัน (Chart.js)
- ✅ ดาวน์โหลด `.docx` (เก็บตัวหนาไว้)
- ✅ บันทึกอัตโนมัติลงเครื่อง (`localStorage`)

**เฟส 2 (ต้องตั้งค่า Google ก่อน — ดูด้านล่าง)**
- ✅ เขียนในเว็บ → ซิงค์เข้า **Google Doc** อัตโนมัติ (เมื่อหยุดพิมพ์ ~1 วิ)
- ✅ เปิด/กดเชื่อมต่อ → ดึงเนื้อหาจาก Doc มาแสดง (อัปเดตล่าสุดจากที่แก้ใน Google Docs)
- ✅ เก็บสถิติจำนวนคำรายวันใน **Google Sheet** (แทน database)
- ✅ **เปลี่ยนบัญชี Google ได้** (ปุ่ม "เปลี่ยนบัญชี") — ไฟล์ Doc/Sheet ผูกกับแต่ละอีเมล สลับบัญชีแล้วแต่ละบัญชีจำไฟล์ของตัวเอง

## วิธีรัน

ต้องรันผ่าน local server (เฟส 2 / Google OAuth ใช้ `file://` ไม่ได้):

```powershell
python -m http.server 5500 --directory D:\webniyay
```
แล้วเปิด **http://localhost:5500**

---

## ตั้งค่า Google (ทำครั้งเดียว) — สำหรับเฟส 2

### 1. สร้างโปรเจกต์ + เปิด API
1. ไปที่ https://console.cloud.google.com
2. สร้าง Project ใหม่ (มุมบนซ้าย)
3. ไปเมนู **APIs & Services → Library** แล้วเปิดใช้ (Enable) ทั้ง 2 ตัว:
   - **Google Docs API**
   - **Google Sheets API**

### 2. ตั้งค่า OAuth consent screen
1. **APIs & Services → OAuth consent screen**
2. เลือก **External** → Create
3. กรอกชื่อแอป + อีเมลของคุณ (ส่วนที่บังคับ)
4. หน้า **Test users** → กด **Add users** ใส่อีเมล Google ของคุณเอง
5. Publishing status ปล่อยเป็น **Testing** (ใช้คนเดียวไม่ต้องส่งรีวิว)

### 3. สร้าง OAuth Client ID
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. **Authorized JavaScript origins** → Add URI: `http://localhost:5500`
4. กด Create แล้ว **คัดลอก Client ID** (ลงท้าย `.apps.googleusercontent.com`)

### 4. ใส่ Client ID ลงในแอป
เปิดไฟล์ `config.js` แล้ววาง Client ID:
```js
CLIENT_ID: "1234567890-abcd....apps.googleusercontent.com",
```

### 5. ใช้งาน
1. รัน server แล้วเปิด `http://localhost:5500`
2. กดปุ่ม **เชื่อมต่อ Google** → ล็อกอิน → อนุญาตสิทธิ์
3. แอปจะสร้างไฟล์ Doc + Sheet ใน Google Drive ของคุณให้อัตโนมัติ (ครั้งแรกครั้งเดียว)
4. เขียนได้เลย ระบบจะซิงค์เข้า Doc + บันทึกสถิติลง Sheet

> หมายเหตุ: ID ของ Doc/Sheet ที่สร้าง ถูกเก็บไว้ใน `localStorage` ของเบราว์เซอร์
> ถ้าล้าง browser data จะสร้างไฟล์ใหม่ (ไฟล์เก่ายังอยู่ใน Drive)

---

## โครงไฟล์

| ไฟล์ | หน้าที่ |
|------|---------|
| `index.html` | โครงหน้าเว็บ |
| `style.css`  | สไตล์ |
| `app.js`     | editor, นับคำ, สถิติ, กราฟ, docx, autosave + เปิด API `window.WT` |
| `google.js`  | OAuth + ซิงค์ Google Docs/Sheets (`window.GoogleSync`) |
| `config.js`  | ใส่ `CLIENT_ID` + ชื่อไฟล์ Doc/Sheet |

## ทิศทางการซิงค์ (ตามที่ออกแบบ)

- **เว็บ → Doc:** เรียลไทม์ (debounce ตอนหยุดพิมพ์)
- **Doc → เว็บ:** ตอนเปิด/กดเชื่อมต่อเท่านั้น (ไม่เรียลไทม์ ตามที่ต้องการ)
