# PanelVid Adapter — Phase 2

Ứng dụng desktop Electron + React + TypeScript, xử lý dữ liệu cục bộ. Phase 1 import Manifest, thư mục ảnh panel, nhiều AI Analysis JSON và Batch Report tùy chọn. Phase 2 bổ sung UUID Mapping, resolve ảnh theo đường dẫn tương đối `panel.file` trong Manifest, validation trạng thái dữ liệu, thống kê và Preview theo cây Chapter → Voice Beat → Panel. Không gọi AI/API, không upload dữ liệu và không ghi/chỉnh sửa file nguồn.

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

## Cách UUID Mapping xử lý dữ liệu

- Mỗi `voice_beats[].panel_uuids[]` được tìm theo UUID chính xác trong `manifest.panels[].uuid`. UUID không hợp lệ, không tồn tại, hoặc UUID trùng trong Manifest được báo riêng; không chọn theo array index, `order` hay thứ tự/tên file.
- Đường dẫn ảnh chỉ được resolve từ `manifest.panels[].file` tương đối với thư mục ảnh đã chọn. Hỗ trợ `/` và `\`, thư mục con và Unicode; đường dẫn tuyệt đối hoặc thoát khỏi thư mục đã chọn bị từ chối.
- Thứ tự `voice_beats` và các `panel_uuids` trong từng beat được giữ nguyên như JSON đầu vào. Một UUID được tham chiếu ở nhiều beat là hợp lệ và chỉ tính một lần trong số UUID phân biệt đã dùng.
- `source_file: null` không chặn mapping nếu Manifest có `panel.file` để tìm ảnh. Số lượng `source_regions` được hiển thị như thông tin bổ trợ, không dùng để đoán tên/path ảnh.
- Kiểm tra ảnh gồm tồn tại, loại file, quyền/truy cập và signature ảnh phổ biến. Preview lấy nội dung cục bộ qua IPC có giới hạn trong thư mục ảnh; trình duyệt giải mã ảnh khi cần hiển thị.
- Thống kê ảnh đếm trên các panel trong Manifest; UUID dùng tính theo UUID phân biệt; số UUID lỗi tách thành sai định dạng, không tồn tại và Manifest thiếu/trùng UUID; panel chưa dùng là UUID hợp lệ, duy nhất không được beat tham chiếu.

## Kiểm thử

```bash
npm test
npm run typecheck
npm run build
```

`npm test` chạy unit/integration tests không cần dữ liệu ảnh ngoài. Bộ test mặc định gồm dữ liệu JSON mẫu thật trong `tests/fixtures/real-sample/`, UUID hợp lệ/sai format/không tồn tại, duplicate UUID, ảnh thiếu/hỏng, đường dẫn tương đối có thư mục lồng và Unicode, nhiều chapter, thứ tự beat/panel, panel lặp ở nhiều beat, `source_file: null` cùng nhiều source regions, traversal protection, preview data URL và test ảnh Phase 1.

### Integration với bộ ảnh thật (tùy chọn)

Test riêng đếm Chapter 0001 **112 ảnh**, Chapter 0002 **113 ảnh**, rồi chạy mapping với Manifest và hai Analysis mẫu: **225 panel**, **219 UUID phân biệt được dùng**, **6 panel chưa dùng**, không thiếu ảnh và không có UUID reference sai/không tồn tại. Thư mục gốc phải chứa `Chapter 0001` và `Chapter 0002`. Bộ ảnh không đóng gói trong project; khi không đặt biến môi trường, test báo hướng dẫn và thất bại rõ thay vì bị skip.

PowerShell:

```powershell
$env:PANELVID_REAL_PANEL_ROOT = 'D:\duong-dan\toi\thu-muc-panel'
npm run test:real-images
```

Command Prompt:

```bat
set "PANELVID_REAL_PANEL_ROOT=D:\duong-dan\toi\thu-muc-panel" && npm run test:real-images
```

## Build và giới hạn phạm vi

`npm run build` tạo renderer tại `dist/` và Electron main/preload tại `dist-electron/`. Chưa tạo EXE, installer hoặc portable. Phase 2 chưa bao gồm Beat Mapper, Logical Page Grouper, tạo SRT/TXT, export sang PanelVid, TTS hoặc render video. Chỉ tiếp tục các phase tiếp theo khi người dùng xác nhận.

Giao diện dùng font cục bộ. Sau khi cài dependencies, ứng dụng không cần Internet trong lúc sử dụng.
