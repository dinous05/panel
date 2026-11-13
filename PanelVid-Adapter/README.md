# PanelVid Adapter — Phase 4

Ứng dụng desktop Electron + React + TypeScript, xử lý dữ liệu cục bộ. Phase 1 import Manifest, thư mục ảnh panel, nhiều AI Analysis JSON và Batch Report tùy chọn. Phase 2 bổ sung UUID Mapping, resolve ảnh theo đường dẫn tương đối `panel.file` trong Manifest, validation trạng thái dữ liệu, thống kê và Preview theo cây Chapter → Voice Beat → Panel. Phase 3 bổ sung Logical Page mặc định theo từng Voice Beat, Scene structure, preview ảnh/narration/metadata, đổi thứ tự panel, chia/gộp Scene và validation bảo toàn tham chiếu. Phase 4 bổ sung Export Preview, validation và package gồm ảnh gốc theo Page/Panel, một SRT cue cho mỗi Voice Beat cùng `export_report.json`. Không gọi API AI/cloud, không upload dữ liệu và không ghi/chỉnh sửa file nguồn.

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

## Beat Mapper & Logical Page Grouper (Phase 3)

- Mỗi Voice Beat tạo một Logical Page, với một Scene ban đầu chứa các panel theo đúng thứ tự reference. Logical Page không đại diện cho trang truyện gốc.
- Chapter order, beat order, narration, emotion, transition và metadata gốc được giữ trong mapping nội bộ. AI Analysis và Manifest chỉ được đọc, không bị ghi lại.
- Trong một Logical Page, có thể di chuyển panel lên/xuống trong Scene, tách Scene sau một panel hoặc gộp Scene với Scene đứng trước. Các thao tác không chuyển panel sang chapter/beat khác và dùng occurrence key riêng để hỗ trợ UUID được tham chiếu lặp.
- Có thể đổi thứ tự cả Scene trong cùng Logical Page; Export Preview hiển thị chính xác thứ tự Scene và panel được làm phẳng.
- Validation báo beat không có panel, mapping/ảnh có lỗi, Scene rỗng, Logical Page bị thiếu/trùng và số panel reference bị thay đổi. Lỗi vẫn được hiển thị để người dùng xử lý; ứng dụng không tự loại bỏ reference.
- Preview nạp ảnh thực tế cục bộ cùng UUID, filename, mapping status, narration, emotion và transition.

## Exporter — Phase 4

- `Export Preview` giữ state chỉnh sửa Logical Page xuyên suốt mapping → preview → export; hiển thị project/chapter/page/scene/panel, narration, UUID, tên file và thumbnail ảnh thực tế.
- `Validate` chặn UUID không duy nhất/không tồn tại, ảnh thiếu/không giải mã được, Logical Page rỗng/sai thứ tự, narration rỗng, panel mất/lặp và file/path không an toàn. Ảnh được re-resolve theo `manifest.panels[].file` trong main process trước khi copy.
- Chọn thư mục cha; package được tạo trong staging cùng filesystem, kiểm tra collision, dung lượng trống, copy nguyên bytes, tạo report rồi rename nguyên tử thành `PanelVid_Output`. Không ghi đè package đã có; lỗi giữa chừng dọn staging.
- Cấu trúc: `Chapter_001/Page 001/Panel 001.<ext>` và `Chapter 001.srt`, mỗi chapter độc lập. Scene được làm phẳng theo thứ tự hiện tại; UUID lặp tạo một bản copy riêng tại mỗi occurrence.
- Report UTF-8 JSON có project/chapter/totals, file paths tương đối, validation và export status; không ghi đường dẫn tuyệt đối.

### Timestamp SRT và tương thích PanelVid v8

Đã kiểm tra trực tiếp source `PanelVid-VoiceStudio-v8.zip` do người dùng gửi. Parser thật `src/voice.js` chấp nhận cue có start `00:00:00,000`, end lớn hơn start, và marker `[TRANG n]` ở đầu text cue; `parseSRT` sort theo start ổn định. Helper thật `buildVoiceTimeline` bắt đầu mỗi cue tại `max(srtStart, cursor)`, trong đó cursor tăng theo duration audio thực tế; Electron `buildVoiceTimeline` gọi `analyzeCue` để lấy thời lượng file audio rồi dựng `pageSegments` từ start thực sau TTS. Do đó SRT tạo ra dùng start `00:00:00,000` cho mỗi cue và window parser-minimum `00:00:00,001`; window này không được dùng để tính voice timeline, còn TTS/page segments được nối theo audio durations thật. Đây là SRT dành cho workflow nhập SRT→TTS của PanelVid v8, không phải subtitle có timing để phát ngoài PanelVid.

Integration test dùng trực tiếp `parseSRT`, `buildVoiceTimeline`, `analyzeMarkers` và `groupPanelItemsByPage` từ source v8; xác nhận Page grouping, `[TRANG n]`, narration, nhiều cue start bằng 0 và timeline mẫu 2.75s + 8.25s thành start `[0, 2.75]`, tổng 11s không chồng lấn. **Chưa chạy synthesis TTS thực tế qua giao diện PanelVid**; test inject audio durations vào pure timeline helper và kiểm tra Electron source logic. Không gửi narration ra dịch vụ mạng và không triển khai TTS trong Phase 4.

Để chạy integration test với source PanelVid đã giải nén:

```bash
PANELVID_V8_SOURCE=/path/to/PanelVid-Video-Voice-SRT npm test
```

### Kiểm thử

```bash
npm test
npm run typecheck
npm run build
```

`npm test` chạy unit tests không cần dữ liệu ảnh ngoài. Bộ test gồm dữ liệu JSON mẫu thật trong `tests/fixtures/real-sample/`, UUID hợp lệ/sai format/không tồn tại, duplicate UUID, ảnh thiếu/hỏng, Unicode, nhiều chapter, thứ tự beat/Scene/panel, panel lặp ở nhiều beat, traversal protection, package/report/SRT, rollback và Logical Page validation. `tests/panelvid-v8.integration.test.ts` được bỏ qua nếu thiếu `PANELVID_V8_SOURCE`; đặt biến môi trường như trên để chạy integration với source v8 thật.

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

`npm run build` tạo renderer tại `dist/` và Electron main/preload tại `dist-electron/`. Chưa tạo EXE, installer hoặc portable. Phase 4 chỉ xuất ảnh, SRT input và report; không tạo voice/TTS, video/subtitle video, không chỉnh sửa PanelVid và không tự mở/điều khiển PanelVid. Không có upload/cloud; sau khi cài dependencies, thao tác ứng dụng chạy cục bộ. Dừng sau Phase 4 và chờ người dùng kiểm tra trước khi tiếp tục.

Giao diện dùng font cục bộ. Sau khi cài dependencies, ứng dụng không cần Internet trong lúc sử dụng.
