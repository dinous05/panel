# PanelCutter 1.1.0 — Báo cáo nâng cấp Panel ID và Manifest

## Tóm tắt

Đã bổ sung Panel ID bền vững theo registry metadata cục bộ, source tracking cho ảnh Manga/Manhwa/Manhua, lịch sử chỉnh sửa split/merge/reorder và `manifest.json` ở cả hai kiểu xuất `preserve` và `flat`. Không thay đổi thuật toán nhận diện/cắt; thao tác nhập, preview, sửa và lưu vẫn theo luồng hiện có.

## File đã thay đổi/thêm

- `electron/main.js`: SHA-256 ảnh nguồn; tạo project key; lưu registry tại thư mục `app.getPath('userData')`; IPC lấy project identity và cấp Panel ID; kiểm tra tính toàn vẹn và ghi manifest trong bước finalize; remap đường dẫn cho preserve/flat.
- `electron/preload.cjs`: thêm hai IPC API giới hạn để lấy project identity và resolve Panel ID.
- `electron/identity-registry.js` **(mới)**: logic cấp project identity và panel identities, tách riêng để test.
- `src/main.js`: gắn ID và metadata nguồn vào panel; tính source regions cho Manga, Manhwa/Manhua; giữ ID khi sắp xếp; cấp ID mới cho split/merge; ghi history; decode ảnh staging để ghi kích thước thực vào manifest; hiển thị ID trong preview.
- `src/manifest-core.js` **(mới)**: schema version, tạo identity keys, theo dõi source regions qua split/merge, validate manifest và remap đường dẫn.
- `test/identity-registry.test.js` **(mới)**: kiểm tra project identity, cấp lại ID cùng key và không tái sử dụng ID đã xóa.
- `test/manifest-core.test.js` **(mới)**: kiểm tra identity key, split/merge source regions, schema, ID/order/path validation và remap preserve/flat.
- `README.md`: hướng dẫn registry, Panel ID, hệ tọa độ crop và manifest.
- `package.json`, `package-lock.json`: version `1.1.0`.
- `dist/`: build production cập nhật.

## Schema manifest chính thức

Manifest được ghi ở thư mục gốc bộ xuất, tên `manifest.json`.

```json
{
  "schema_version": "1.0",
  "project": {
    "project_id": "UUID",
    "project_name": "Chapter_001",
    "created_at": "ISO-8601",
    "exported_at": "ISO-8601"
  },
  "source": {
    "source_type": "ZIP | CBZ | RAR | CBR / RAR | FOLDER",
    "source_name": "chapter.zip",
    "reading_direction": "rtl | ltr | null",
    "comic_type": "manga | manhwa | manhua"
  },
  "coordinate_system": {
    "units": "pixel",
    "origin": "top_left",
    "crop": "half-open rectangle [x,x+width) × [y,y+height) in original source image"
  },
  "export_layout": "preserve | flat",
  "panels": [
    {
      "id": "P000001",
      "uuid": "UUID",
      "file": "relative/path/to/panel.jpg",
      "order": 1,
      "source_page": 1,
      "source_file": "001.jpg",
      "width": 1200,
      "height": 900,
      "crop": { "x": 0, "y": 0, "width": 1200, "height": 900 },
      "source_regions": [
        {
          "source_page": 1,
          "source_file": "001.jpg",
          "source_fingerprint": "sha256 hex digest",
          "source_width": 1200,
          "source_height": 1800,
          "crop": { "x": 0, "y": 0, "width": 1200, "height": 900 },
          "output_y": 0,
          "output_height": 1
        }
      ],
      "decision": "SHOW",
      "review_required": false,
      "edit_history": [],
      "parent_ids": []
    }
  ]
}
```

`source_page` đánh số từ 1 theo thứ tự ảnh nguồn đã quét. `crop` là hình chữ nhật pixel nguyên, gốc trên-trái, biên phải/dưới không bao gồm. `source_regions` cho phép một panel tham chiếu nhiều ảnh nguồn; `output_y`/`output_height` mô tả vùng đóng góp theo tỷ lệ dọc trong panel đầu ra. Các trường đơn nguồn `source_page`, `source_file`, `crop` ở cấp panel là `null` khi panel có nhiều vùng nguồn. `width` và `height` là kích thước được giải mã từ ảnh staging ngay trước khi xuất.

`file` luôn là đường dẫn tương đối trong bộ xuất thực tế. Chế độ `flat` đổi sang tên file phẳng có tiền tố thứ tự; manifest được remap theo đúng tên sau copy.

## Quy tắc định danh

- ID hiển thị là `P000001`, ...; UUID được giữ làm khóa không phụ thuộc tên file hoặc thứ tự preview.
- Registry nằm trong `app.getPath('userData')/panel-identities.json`, không nằm trong thư mục output và không chứa ảnh/draft.
- Project key được tạo từ loại nguồn và đường dẫn tuyệt đối nguồn. Cùng nguồn tại cùng đường dẫn giữ project ID; di chuyển nguồn sang đường dẫn khác được coi là project mới.
- Khóa panel nguồn dùng fingerprint SHA-256 ảnh, số trang nguồn và tọa độ crop; tên file không tham gia khóa panel. Registry không xóa identity đã cấp khi panel bị xóa, nên bộ đếm không tái sử dụng ID.
- Reorder chỉ cập nhật `edit_history`, không đổi ID. Split tạo hai identity mới dẫn xuất từ UUID panel cha và tỷ lệ chia. Merge tạo identity mới dẫn xuất theo UUID cha theo đúng thứ tự gộp; `parent_ids` chứa ID nguồn.

## Kiểm tra xuất

Trước khi hoàn tất, ứng dụng kiểm tra schema, UUID/ID không trùng, order liên tục, file path không traversal, kích thước dương, decision/review, crop nằm trong kích thước ảnh nguồn, source regions hợp lệ (source_file/source_page có thể null nếu chưa truy vết được), và danh sách manifest khớp chính xác với ảnh trong staging. Sau khi copy, từng file manifest được stat để bảo đảm tồn tại và không rỗng; JSON được parse lại trước khi ghi `manifest.json`. Lỗi trong copy/ghi manifest sẽ xóa thư mục output chưa hoàn chỉnh và giữ staging để người dùng thử lại.

## Bản sửa lỗi lưu (2026-11-13)

Sau khi nhận ảnh chụp lỗi, validator được nới để `source_file` và `source_page` có thể null/không có; nếu có thì vẫn phải đúng kiểu và source_page phải ≥1. Lỗi metadata truy vết không còn chặn tạo folder/ghi manifest, trong khi crop, kích thước, ID và đường dẫn vẫn được kiểm tra. Đã thêm test hồi quy cho trường hợp attribution null.

## Kết quả kiểm thử

- `npm test`: **31 test đạt, 0 lỗi** (24 test cũ + 7 test mới).
- `node --check`: đạt với `src/main.js`, `src/manifest-core.js`, `electron/main.js`, `electron/identity-registry.js`, `electron/preload.cjs`.
- `npm run build`: thành công; Vite production build.
- `npm audit --omit=dev --audit-level=moderate`: không phát hiện lỗ hổng dependency production.
- `npm ci` báo 8 cảnh báo lỗ hổng trong dependency graph đầy đủ (6 moderate, 2 high); không chạy `npm audit fix` vì nằm ngoài phạm vi và có thể thay đổi dependency/build.

## Ví dụ manifest từ dự án thật

ZIP đầu vào chỉ chứa source code, không có trang truyện/chapter để chạy một lần export thực tế. Vì vậy chưa thể cung cấp manifest được sinh từ dự án truyện thật mà không bịa dữ liệu. README có ví dụ schema minh họa; các test dùng fixture tổng hợp.

## Giới hạn còn lại

- Chưa chạy ứng dụng Electron trên Windows hoặc test giao diện end-to-end; build đã xác minh là Vite production build, chưa tạo gói portable `.exe` trong môi trường Linux.
- Chưa kiểm thử manifest export bằng bộ ảnh truyện thật; module remap/schema, registry và toàn bộ test thuật toán đã chạy tự động.
- Registry được nhận diện bằng đường dẫn tuyệt đối nguồn; đổi vị trí archive/folder tạo project ID mới. Nếu đổi thứ tự các trang nguồn, `source_page` thay đổi và có thể tạo identity key mới cho các panel đó.
- Nếu cùng một ảnh nguồn bị lặp lại nhiều lần trong một dự án với cùng crop, khóa còn phân biệt bằng `source_page`; hệ thống coi đó là các vị trí nguồn khác nhau.
- Registry chứa lịch sử identity keys và tăng theo thời gian; hiện chưa có công cụ quản lý/dọn registry, bởi xóa nhầm registry sẽ làm mất khả năng duy trì ID cũ.
- `review_required` mặc định `false` và `decision` mặc định `SHOW`; chưa triển khai AI review/contact sheet theo yêu cầu phạm vi.

## Cách chạy

Trong thư mục `PanelCutter-Standalone`:

```bash
npm ci
npm test
npm run build
npm run app
```

Hoặc trên Windows, chạy `CHAY-PANELCUTTER.bat` như trước. Khi xuất, chọn preserve/flat; manifest được tạo tự động cùng các ảnh.

## Lưu ý cho PanelVid Adapter

Adapter nên dùng `uuid` làm khóa nội bộ, `id` làm mã dễ đọc và `file` làm đường dẫn thực tế; không suy luận tên ảnh từ order. Dùng `order` để sắp nội dung, `source_regions` để truy vết nguồn (Manhwa/Manhua có thể nhiều vùng), `parent_ids`/`edit_history` để hiểu panel đã chia/gộp. Schema có `schema_version` để Adapter có thể từ chối hoặc nâng cấp định dạng không hỗ trợ.
