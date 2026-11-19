# PanelCutter 1.1.7 — Current implementation report

## Thay đổi release 1.1.5

- Bố trí Contact Sheet đọc `DEFAULT_VERTICAL_LAYOUT` làm nguồn giới hạn mặc định; giao diện cho phép đặt chiều cao tối đa và số cột, các giá trị thực tế được lưu trong `ContactSheetLayout.json`.
- Metadata phân biệt `source_reading_direction` với `layout_reading_order: "top_to_bottom_then_left_to_right"`.
- Nhãn panel được giới hạn trong chiều rộng panel/cột.
- Bỏ chia panel dài tự động theo 16:9. Trong preview, người dùng tự thêm, nhập/kéo, xóa một hoặc nhiều mốc; chỉ xác nhận mới tạo các đoạn liền nhau, giữ thứ tự và source-region mapping.
- Panel cao hơn vùng nội dung Contact Sheet được chia thành lát pixel liền nhau chỉ trong bản sheet, tiếp nối qua cột/sheet. Lưu `source_y`, `source_height`, `segment_index/count`; giữ nguyên ảnh panel xuất, UUID, Manifest và PanelMapping.
- Sửa lỗi `sheet is not defined` khi xuất AI Package.
- Trong hộp thoại Chia panel, thêm ngưỡng px/phần có thể chỉnh; panel dài hơn ngưỡng được gợi ý các mốc cân bằng. Người dùng vẫn có thể chỉnh mốc và phải xác nhận mới chia.
- Version ứng dụng đồng bộ: `package.json`, `package-lock.json`, README và báo cáo này đều là 1.1.7.

### Xác minh release 1.1.7

- `npm test`: 54/54 test pass.
- `node --check` cho renderer, layout, manual-split helper, strip slicer và Electron main: pass.
- `npm run build`: pass.

## Lịch sử release 1.1.1 — Hotfix kỹ thuật và kiểm thử

## Phạm vi

Đã sửa lỗi đóng gói, chia source regions, kiểm tra UUID, độ bền Identity Registry và luồng xuất Preserve/Flat. Không sửa thuật toán nhận diện Manga, thuật toán dò khe Manhwa/Manhua, quy tắc RTL/LTR hoặc giao diện. Theo yêu cầu của người dùng, **không tạo Windows Portable `.exe`**.

## Lỗi đã sửa

### 1. Thiếu `src/manifest-core.js` trong gói Electron

`electron/main.js` nhập `../src/manifest-core.js` thông qua `electron/export-core.js`, nhưng cấu hình electron-builder chỉ đưa `dist/**/*`, `electron/**/*`, `package.json` và dependency vào package. Đã thêm đúng một module nguồn cần thiết, `src/manifest-core.js`, vào `build.files`; không đưa toàn bộ `src` vào app package. `electron/export-core.js` được đưa vào nhờ `electron/**/*`.

Đã chạy electron-builder target Linux `dir` để tạo app.asar phục vụ kiểm tra cấu trúc (không phải Windows app/EXE). `asar list` xác nhận có `/electron/main.js`, `/electron/export-core.js`, `/electron/identity-registry.js`, `/src/manifest-core.js` và `/package.json` ở đúng vị trí tương đối cho import. Đây là kiểm tra nội dung ASAR được tạo trên Linux; không khẳng định Windows Portable build hoặc runtime đã được kiểm thử.

### 2. Split source regions làm tròn pixel

`splitSourceRegions()` trước đây làm tròn tọa độ đầu/cuối độc lập, có thể tạo phần crop bị lặp/mất pixel hoặc vượt source boundary. Đã đổi sang tính một tọa độ pixel nguyên duy nhất tại giao điểm split với từng source region. Phần trên kết thúc đúng tại tọa độ đó, phần dưới bắt đầu tại cùng tọa độ; biên gốc được giữ nguyên. Các region không cắt qua split được giữ nguyên crop. Khi split đúng ở ranh giới giữa hai ảnh nguồn, source regions của từng phía không bị gộp nhầm.

Test mới kiểm tra crop cao lẻ/chẵn, ratio 0.5 và khác 0.5, crop bắt đầu tại `y != 0`, crop sát source boundary, panel nhiều source regions và split đúng tại ranh giới hai ảnh. Các test xác nhận không mất/trùng pixel, đúng liền kề và không vượt `source_height`.

### 3. UUID trùng lặp trong Manifest

`validateManifest()` hiện duy trì `seenUuids`, từ chối UUID trùng, UUID rỗng/whitespace và giá trị UUID sai kiểu. Quy tắc kiểm tra ID/order/path/crop hiện hữu vẫn còn. Registry cũng kiểm tra ID và UUID identity không trùng trong project trước khi đọc/ghi.

### 4. Identity Registry

- Gọi `app.requestSingleInstanceLock()` và đưa cửa sổ hiện hành lên trước khi cho instance thứ hai tiếp tục; khi thất bại, instance thứ hai thoát.
- Tuần tự hóa thao tác đọc–sửa–ghi registry trong main process, tránh race cùng tiến trình giữa hai IPC request.
- Registry schema version 1 được kiểm tra trước khi cập nhật; counter phải lớn hơn mọi ID đã cấp, hạn chế việc reset counter gây tái sử dụng.
- Ghi registry qua file tạm unique, flush file handle rồi rename; lưu `.bak` hợp lệ trước khi thay primary. Thay backup có xử lý tình huống Windows từ chối rename-over-existing.
- Khi primary không đọc/parse/validate được, thử backup. Nếu phục hồi, giữ thêm bản primary hỏng với tên `.corrupt-<timestamp>-<uuid>` rồi restore backup. Nếu không có backup hợp lệ, phát lỗi và không ghi đè/xóa primary hoặc backup.
- Registry giữ identity đã từng cấp, nên xóa một mapping không làm counter lùi hoặc tái sử dụng số ID.

### 5. Preserve/Flat Export

Đã tách logic dùng thực tế bởi Electron IPC sang `electron/export-core.js` để chạy filesystem integration tests. Cả Preserve và Flat đều kiểm tra Manifest với staging, remap đường dẫn đầu ra, xác thực lại sau remap, xác nhận file ảnh có tồn tại/không rỗng, ghi JSON rồi mới báo hoàn tất. Flat đặt prefix theo `manifest.order`, không theo thứ tự duyệt filesystem. Nếu validate/copy/ghi Manifest thất bại, output folder chưa hoàn chỉnh bị xóa và staging được giữ để thử lại.

## File đã thay đổi hoặc thêm

- `package.json`: version `1.1.1`, thêm chính xác `src/manifest-core.js` vào `build.files`.
- `package-lock.json`: đồng bộ version gốc `1.1.1`.
- `src/manifest-core.js`: pixel-safe split và phát hiện UUID duplicate.
- `electron/main.js`: single-instance lock, registry serialization/recovery và sử dụng export-core.
- `electron/identity-registry.js`: schema checks, ID/UUID safety, atomic persistence, backup/restore, serial queue.
- `electron/export-core.js` (mới): export/re-map/validation/rollback.
- `test/manifest-core.test.js`: split boundary, multi-source và UUID tests.
- `test/identity-registry.test.js`: uniqueness/counter, recovery/corruption, backup và serialization tests.
- `test/export-integration.test.js` (mới): Preserve/Flat trên thư mục tạm, final manifest, đường dẫn, lỗi và staging retention.
- `README.md`: ghi version mới, registry recovery và các quy tắc split.
- `IMPLEMENTATION-REPORT.md`: báo cáo hotfix này.
- `dist/`: Vite production build mới.

## Kết quả xác minh

- `npm test`: **45/45 test đạt, 0 lỗi**. Bao gồm test thuật toán hiện có và test mới cho split, UUID, registry và export. Integration tests dùng filesystem tạm thật; ảnh fixtures là byte mẫu và không thay thế kiểm thử detector/UI với chapter truyện thật.
- `node --check`: thành công với `electron/main.js`, `electron/identity-registry.js`, `electron/export-core.js`, `src/manifest-core.js` và `src/main.js`.
- `npm run build`: Vite production build thành công.
- `npx electron-builder --linux dir --x64`: tạo `release/linux-unpacked/resources/app.asar` để kiểm tra package layout trên Linux.
- `asar list`: xác nhận `src/manifest-core.js` cùng các module Electron có trong app.asar.
- Không chạy `npm run dist:win`; không tạo `.exe`; không tuyên bố Windows build/runtime PASS.

## Chưa thể xác nhận

- Windows Portable build, mở/chạy `.exe`, `ERR_MODULE_NOT_FOUND` trên Windows thực tế: **chưa kiểm thử**, theo yêu cầu không tạo exe.
- Electron UI end-to-end với source chapter thật và detector thực: **chưa chạy**. Preserve/Flat được integration test qua export module production trên filesystem fixture; test không giải mã ảnh fixture.
- Giao diện Windows và hành vi `requestSingleInstanceLock()` khi mở song song trên Windows: **chưa chạy trên Windows**. Registry queue, serialization và recovery được unit-tested trong Node; mã single-instance được kiểm tra qua source.
- Package ASAR được tạo cho Linux chỉ để kiểm tra include graph; không xem đó là bằng chứng Windows runtime.
- Dependency audit khi cài đặt vẫn cảnh báo 8 lỗ hổng trong dependency graph đầy đủ (6 moderate, 2 high); không chạy audit fix vì ngoài phạm vi hotfix.

## Chạy lại kiểm tra

```bash
npm ci
npm test
npm run build
```

Không có file `.exe` được tạo hoặc đính kèm trong bàn giao này.
