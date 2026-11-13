# PanelVid Adapter — Phase 1

Ứng dụng desktop Electron + React + TypeScript, xử lý dữ liệu cục bộ. Bản Phase 1 có giao diện tổng quan và import thật cho Manifest JSON, thư mục ảnh panel, nhiều AI Analysis JSON và Batch Report tùy chọn. Ứng dụng không gọi AI/API, không upload dữ liệu và không ghi/chỉnh sửa file nguồn.

## Chạy trên Windows

1. Giải nén toàn bộ project vào một thư mục.
2. Cài Node.js LTS nếu máy chưa có.
3. Nhấp đúp `CHAY-PANELVID-ADAPTER.bat`.

Launcher tự cài dependency khi chưa có, build Electron main/preload và renderer, rồi mở app. Lần cài dependency đầu tiên cần kết nối Internet; sau đó ứng dụng không cần mạng trong quá trình sử dụng.

## Chạy ở chế độ phát triển thủ công

```bash
npm install
npm run dev
```

`npm run dev` tự build trước khi khởi chạy Electron. Các thao tác import dùng hộp thoại file/thư mục native của hệ điều hành.

## Kiểm thử và build

```bash
npm test
npm run typecheck
npm run build
```

`npm run build` tạo renderer tại `dist/` và Electron main/preload tại `dist-electron/`. Chưa tạo EXE, installer hoặc portable ở Phase 1.

## Phạm vi Phase 1

- Đọc cú pháp JSON cơ bản, bỏ UTF-8 BOM nếu có.
- Hiển thị thông tin project, schema version, số panel, chapter và voice beat khi trường tương ứng hiện diện.
- Quét số lượng ảnh trong thư mục đã chọn, gồm các thư mục con.
- Reset chỉ xóa trạng thái trong phiên ứng dụng; không xóa file nguồn.
- Chưa kiểm tra schema đầy đủ, UUID, tham chiếu panel, Batch Report consistency; chưa có beat mapping hoặc exporter.

Giao diện và font dùng hệ thống cục bộ; không cần kết nối Internet trong lúc sử dụng.
