# PanelVid Adapter — Phase 1

Ứng dụng desktop Electron + React + TypeScript, xử lý dữ liệu cục bộ. Bản Phase 1 có giao diện tổng quan và import thật cho Manifest JSON, thư mục ảnh panel, nhiều AI Analysis JSON và Batch Report tùy chọn. Ứng dụng không gọi AI/API, không upload dữ liệu và không ghi/chỉnh sửa file nguồn.

## Chạy trên Windows

1. Giải nén toàn bộ project vào một thư mục.
2. Cài Node.js LTS nếu máy chưa có.
3. Nhấp đúp `CHAY-PANELVID-ADAPTER.bat`.

Launcher kiểm tra dependency, tự cài/sửa nếu thiếu hoặc không đầy đủ, sau đó build và mở app. Lần cài dependency đầu tiên cần Internet; khi dependency đã được cài, app không cần mạng trong quá trình sử dụng. Nếu Node.js/npm thiếu hoặc cài đặt/build thất bại, launcher hiển thị thông báo hướng xử lý rồi giữ cửa sổ để xem lỗi.

## Chạy ở chế độ phát triển thủ công

```bash
npm install
npm run dev
```

`npm run dev` tự build Electron main/preload, khởi động Vite trên `127.0.0.1:5173` và tải giao diện trực tiếp từ dev server. Nếu cổng 5173 đang bận, Vite dừng rõ ràng thay vì tự đổi sang cổng khác. Electron ghi URL renderer đã nạp vào log.

## Kiểm thử mặc định

```bash
npm test
npm run typecheck
npm run build
```

`npm test` bao gồm các JSON mẫu thực tế đã gửi kèm tại `tests/fixtures/real-sample/`, không cần biến môi trường và không bị skip. Test xác nhận manifest có 225 panel, Analysis chapter 1 có 29 beat, chapter 2 có 25 beat, tổng 54 beat, cùng Batch Report có 54 beat. Test ảnh tổng hợp bao gồm thư mục rỗng, thư mục lồng nhiều cấp, phần mở rộng ảnh không phân biệt hoa thường, file không phải ảnh, đường dẫn không tồn tại và lỗi quyền truy cập EACCES.

### Kiểm tra hai thư mục ảnh thật (tùy chọn nếu có bản export đầy đủ)

Test riêng xác nhận Chapter 0001 có 112 ảnh và Chapter 0002 có 113 ảnh. Thư mục gốc phải chứa hai folder `Chapter 0001` và `Chapter 0002`. Test không nằm trong `npm test`, vì bộ ảnh đầy đủ không được đóng gói vào project. Nếu biến môi trường bị thiếu, test riêng báo lỗi hướng dẫn thay vì bỏ qua.

PowerShell:

```powershell
$env:PANELVID_REAL_PANEL_ROOT = 'D:\duong-dan\toi\thu-muc-panel'
npm run test:real-images
```

Command Prompt:

```bat
set "PANELVID_REAL_PANEL_ROOT=D:\duong-dan\toi\thu-muc-panel" && npm run test:real-images
```

## Build

```bash
npm run build
```

Lệnh tạo renderer tại `dist/` và Electron main/preload tại `dist-electron/`. Chưa tạo EXE, installer hoặc portable ở Phase 1.

## Phạm vi Phase 1

- Đọc cú pháp JSON cơ bản, bỏ UTF-8 BOM nếu có.
- Hiển thị thông tin project, schema version, số panel, chapter và voice beat khi trường tương ứng hiện diện.
- Quét số lượng ảnh trong thư mục đã chọn, gồm các thư mục con.
- Reset chỉ xóa trạng thái trong phiên ứng dụng; không xóa file nguồn.
- Chưa kiểm tra schema đầy đủ, UUID, tham chiếu panel, Batch Report consistency; chưa có beat mapping hoặc exporter.

Giao diện và font dùng hệ thống cục bộ; không cần kết nối Internet trong lúc sử dụng.
