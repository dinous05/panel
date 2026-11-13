# Cập nhật giao diện và hàng đợi trên bản batch-render-optimized

Bản cập nhật này được làm trực tiếp trên dự án từ `PanelVid-v10-batch-render-optimized.zip`. Giữ nguyên luồng render nhiều chap nhanh: chọn folder/ZIP ảnh và folder TXT/SRT, tự ghép chap với phụ đề, chuẩn bị job theo chap, render lần lượt trong hàng đợi và tiếp tục xử lý khi có lỗi từng job.

## Cài đặt chung

Các tùy chọn video đầu ra (FPS, chất lượng, mã hóa, số luồng render, thứ tự đọc, cách trình bày và phụ đề) nằm trong **Cài đặt chung** mở bằng nút bánh răng. Khung **Xuất video** chỉ giữ các thao tác tạo MP4 và đưa chap vào hàng đợi. Phần chọn chia thời lượng và tổng ước tính đã bỏ khỏi giao diện; app vẫn tự đồng bộ thời gian theo voice SRT/TXT khi có voice.

## Xóa toàn bộ hàng đợi

Nút **Xóa toàn bộ** gỡ các job khỏi danh sách sau khi xác nhận. Các file MP4 đã render không bị xóa. Nút tạm khóa khi hàng đợi đang chạy; hãy dừng hàng đợi trước nếu muốn xóa.

## Tạo voice và render song song

Trong hàng đợi nhiều chap, voice của chap kế tiếp được tạo trong lúc chap hiện tại đang render. Render MP4 vẫn diễn ra tuần tự, và chỉ có một tiến trình tạo voice tại một thời điểm. Tiến độ và nút Dừng được gắn đúng cho voice/render hiện tại. Audio tạm của chap đang render được giữ tới khi FFmpeg dùng xong.

## Lựa chọn FPS

Trong Cài đặt chung có lựa chọn 30, 45 hoặc 60 FPS. Tùy chọn áp dụng cho xuất trực tiếp và được lưu vào mỗi job hàng đợi, bao gồm cả các job tạo qua Batch. Tùy chọn FPS gần nhất cũng được ghi nhớ; mặc định là 60 FPS.

## Batch TXT/SRT dạng ZIP và đối chiếu số lượng

Mục render nhiều chap nhận cả folder TXT/SRT lẫn ZIP chứa phụ đề. Chapter/folder và TXT/SRT được sắp xếp theo tên tự nhiên (2 trước 10), ghép tên trùng trước rồi ghép phần còn lại theo thứ tự. SRT lệch số cue không cần hộp xác nhận; mỗi chap vẫn giữ voice riêng.

Có thể bật **Tự nối MP4 sau khi render xong** và đặt tên file tổng. App giữ các MP4 từng chap, đợi toàn bộ queue kết thúc rồi mới nối theo đúng thứ tự batch. Nếu các chap cùng chuẩn H.264/AAC, FFmpeg nối stream-copy, không encode video lại; nếu khác chuẩn, sẽ chuẩn hóa/encode bằng CPU nên có thể mất thêm thời gian.

## Thời gian voice + render

Hàng đợi có bộ đếm tổng thời gian chạy, đồng thời mỗi job hiển thị thời lượng đã chạy gồm voice và render. Thời gian job được lưu cùng trạng thái để không mất khi đóng app hoặc dừng rồi chạy tiếp.

## Cân bằng âm lượng voice

Mỗi cue voice được chuẩn hóa theo loudness tích hợp EBU R128 (mục tiêu -18 LUFS / đỉnh thật -2 dBTP). Khi trộn, tắt tự động đổi gain theo số input còn hoạt động, nguyên nhân có thể khiến các đoạn cuối bị đẩy âm lượng lên; limiter vẫn giữ đỉnh an toàn. Phép phân tích loudness vẫn có thể dừng cùng tác vụ tạo voice.
