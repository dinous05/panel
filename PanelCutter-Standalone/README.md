# Panel Cutter Offline

App desktop Windows chỉ dùng để tách ảnh truyện thành panel. Phần tạo voice, timeline và xuất video thuộc app khác, không có trong ứng dụng này.

## Dùng app

1. Chọn một file **ZIP, CBZ, RAR hoặc CBR**, hoặc chọn một folder ảnh. Folder được quét cả thư mục con.
2. Chọn **Manga**, **Manhwa** hoặc **Manhua**. Với Manga, chọn thứ tự panel phải-sang-trái (mặc định) hoặc trái-sang-phải.
3. Với Manhwa/Manhua, chỉnh **Độ dày khe tối thiểu** từ 0 đến 1000 px. Giá trị 0 dùng ngưỡng tự động nhạy hơn; tăng giá trị để bỏ qua separator mỏng. Nếu khe trắng rõ nhưng còn bị bỏ sót, hạ về 0 hoặc thử 1–10 px. Không có bộ lọc độ sáng.
4. Bấm **Bắt đầu cắt**. Panel được tạo trong vùng tạm và hiển thị preview; lúc này chưa có folder kết quả được ghi ra.
5. Rà preview trước khi lưu: bấm ảnh để **phóng to**, bấm **Chia** trên panel cần tách để kéo đường ngang hoặc chỉnh thanh trượt; xác nhận sẽ thay panel đó bằng hai ảnh theo thứ tự trên/dưới. Dùng **Xóa** để bỏ panel thừa và **Gộp vào ảnh trước** để nối panel đang chọn xuống panel liền trước. Với Manga, dùng **↑ / ↓** để đổi thứ tự panel trong cùng trang. Các thao tác sửa sẽ đánh số lại file tự động; mọi chỉnh sửa vẫn ở vùng tạm cho đến khi lưu. Nếu có nhiều panel, dùng **Hiện thêm panel** để xem thêm kết quả.
6. Khi đã kiểm tra xong, bấm **Lưu ảnh đã cắt…**, chọn thư mục đích. App mới tạo folder kết quả và chép các ảnh đã chỉnh vào đó. Nếu đóng app trước khi lưu, kết quả tạm được xóa.

Định dạng ảnh đầu vào: JPG/JPEG, PNG, WebP và BMP. Archive được giải nén bằng 7-Zip đi kèm app; archive có mật khẩu sẽ báo lỗi (chưa có giao diện nhập mật khẩu).

## Cấu trúc kết quả

- **Manga**: folder kết quả chứa một folder cho mỗi trang, ví dụ `0001_page-01/panel_001.jpg`, `0001_page-01/panel_002.jpg`.
- **Manhwa / Manhua**: một folder kết quả chứa ảnh panel theo thứ tự đọc dọc, ví dụ `panel_0001.jpg`, `panel_0002.jpg`.

App sắp nguồn theo thứ tự tự nhiên của tên/đường dẫn (`1`, `2`, `10`). Với Manhwa/Manhua, app ghép logic các profile hàng trước khi dò khe; panel có thể nối qua ranh giới hai ảnh đầu vào. Ảnh nguồn không bị ghép/xóa. Các ngưỡng khe được áp dụng cho profile dải đã ghép. Nếu tổng ảnh không tạo thành dải dọc đủ cao, app quay về xử lý ảnh theo từng file.

**Cách cắt Manga:** model ONNX ngoại tuyến nhận diện các khung trên toàn trang gốc một lần; app lọc box trùng/lồng nhau, sắp theo thứ tự đọc, rồi crop từng vùng để tạo preview. App không chạy nhận diện đệ quy trên ảnh panel vừa crop. Để tránh tạo thêm ảnh từ nội dung nằm bên trong một panel đã nhận diện, box nhỏ bị loại nếu box lớn hơn phủ ít nhất 70% diện tích box nhỏ và tâm box nhỏ nằm trong box lớn (cho phép sai lệch biên 2,5% trang). Nếu model không trả box hợp lệ, app dùng heuristic dự phòng; nếu vẫn không tìm được thì giữ nguyên trang thành một ảnh. Heuristic và model đều có thể nhầm đường viền, nên cần rà preview và dùng **Chia**, **Xóa** hoặc **Gộp vào ảnh trước** để sửa trước khi lưu.

Manhwa/Manhua cắt tại dải ngang đồng màu toàn chiều rộng; hàng gần trắng được chấp nhận nếu ít nhất 99,5% pixel là trắng/gần trắng để chịu được một ít nhiễu nén. Khi hai hàng phẳng đổi màu đột ngột, bộ dò kết thúc run cũ và bắt đầu run mới để màu viền đen/xanh không làm mất dải trắng bên cạnh; gradient đổi màu từ từ vẫn không được xem là separator. Ngưỡng tự động đã giảm để bắt khe mỏng hơn; vùng chứa chữ/nội dung xuyên qua dải vẫn bị loại. Nếu bộ dò chưa nhận một khe cụ thể, có thể dùng **Chia** trên panel preview để đặt điểm cắt thủ công. Hãy xem lại kết quả trước khi lưu.

## Khởi chạy trên Windows bằng BAT

Giải nén ZIP vào một thư mục rồi chạy `CHAY-PANELCUTTER.bat`. Cần cài Node.js 22 trở lên. Lần đầu chạy, BAT dùng `npm ci` để cài dependencies và cần Internet; các lần sau sẽ build giao diện rồi mở app. App không cần Python và không gọi dịch vụ mạng khi xử lý ảnh.

Nếu muốn chạy thủ công từ source:

```bash
npm ci
npm run build
npm run app
```

Model Manga được phân phối kèm giấy phép trong `resources/MANGA-PANEL-MODEL-LICENSE.txt`. Dependency 7-Zip đi kèm có giấy phép MIT trong gói npm tương ứng.

## Panel ID và manifest.json (v1.1.0)

Khi lưu kết quả, PanelCutter tạo thêm `manifest.json` ở thư mục gốc của bộ xuất, cho cả hai kiểu `preserve` và `flat`. Manifest gồm `schema_version: "1.0"`, `project`, `source`, `coordinate_system`, `export_layout` và danh sách `panels`. Mỗi panel có `id` dạng `P000001`, UUID nội bộ, đường dẫn ảnh đầu ra, thứ tự đọc, kích thước ảnh thực tế, quyết định mặc định `SHOW`, trạng thái review mặc định `false`, lịch sử chỉnh sửa và các `source_regions`.

Tọa độ crop dùng pixel nguyên, gốc ở góc trên-trái ảnh nguồn; hình chữ nhật là nửa mở `[x, x + width) × [y, y + height)`. Với panel được tạo từ nhiều ảnh nguồn, `source_regions` chứa nhiều vùng; `output_y` và `output_height` là tỷ lệ trong panel đầu ra để mô tả phần đóng góp theo chiều dọc. `source_page` đánh số từ 1 theo thứ tự ảnh nguồn đã sắp xếp. Trong `source_regions`, `source_file`/`source_page` có thể là `null` nếu một pipeline không cung cấp attribution; điều này không chặn lưu. `crop` và `source_page` ở cấp panel chỉ có giá trị khi có đúng một vùng nguồn; nếu có nhiều vùng, các trường đơn nguồn là `null`.

Registry riêng `panel-identities.json` được lưu trong thư mục dữ liệu người dùng của Electron, không nằm trong folder ảnh đầu ra. Registry giữ project ID, bộ đếm và ánh xạ identity key → UUID/Panel ID; ID đã cấp không bị tái sử dụng khi xóa panel. Project được nhận diện bằng loại nguồn và đường dẫn tuyệt đối; di chuyển source sang đường dẫn khác sẽ được coi là project khác. Khóa panel dùng SHA-256 nội dung ảnh nguồn, số trang nguồn và tọa độ crop (không dùng tên file hoặc thứ tự hiển thị); thao tác chia/gộp dùng khóa dẫn xuất từ panel cha/nguồn. Registry không lưu ảnh, draft giao diện hoặc trạng thái staging.

Ví dụ rút gọn:

```json
{
  "schema_version": "1.0",
  "project": { "project_id": "<UUID ổn định>", "project_name": "Chapter_001", "created_at": "2026-11-13T00:00:00.000Z", "exported_at": "2026-11-13T00:05:00.000Z" },
  "source": { "source_type": "ZIP", "source_name": "Chapter_001.zip", "reading_direction": "rtl", "comic_type": "manga" },
  "coordinate_system": { "units": "pixel", "origin": "top_left", "crop": "half-open rectangle [x,x+width) × [y,y+height) in original source image" },
  "export_layout": "preserve",
  "panels": [
    {
      "id": "P000001", "uuid": "<UUID ổn định>", "file": "0001_page-01/panel_001.jpg", "order": 1,
      "source_page": 1, "source_file": "001.jpg", "width": 1200, "height": 900,
      "crop": { "x": 0, "y": 0, "width": 1200, "height": 900 },
      "source_regions": [{ "source_page": 1, "source_file": "001.jpg", "source_width": 1200, "source_height": 1800, "crop": { "x": 0, "y": 0, "width": 1200, "height": 900 }, "output_y": 0, "output_height": 1 }],
      "decision": "SHOW", "review_required": false, "edit_history": [], "parent_ids": []
    }
  ]
}
```

Adapter nên đọc `file` trực tiếp từ manifest thay vì tự dựng tên. Với panel chia/gộp, ID mới được cấp, `parent_ids` trỏ tới panel nguồn và `edit_history` ghi thao tác; đổi thứ tự không đổi ID. Registry được nhận diện theo loại nguồn và đường dẫn tuyệt đối; nếu đổi vị trí source thì ứng dụng coi đó là project mới.
