# PanelVid Voice Clone

Đây là cửa sổ ứng dụng Voice Clone riêng, khởi chạy bằng `CHAY-VOICE-CLONE.bat`; ứng dụng PanelVid chính vẫn mở bằng `CHAY-PANELVID.bat`.

## Khởi động lần đầu

1. Giải nén toàn bộ thư mục dự án vào một vị trí có quyền ghi.
2. Cài Node.js 22 LTS và Python 3.11 (khi cài Python, bật **Add Python to PATH**).
3. Nhấp đúp `CHAY-VOICE-CLONE.bat` và giữ kết nối Internet trong lần cài engine/model đầu tiên. Launcher kiểm tra/cài Chatterbox và VieNeu-TTS, cài Electron dependencies, build giao diện rồi mở app clone riêng.
4. Khởi động lần sau bằng cùng file BAT; các gói đã có sẽ được bỏ qua.

Model giọng có thể cần tải thêm trong lần chạy đầu. GPU CUDA tương thích được ưu tiên khi có; nếu không, Chatterbox có thể chạy CPU nhưng chậm hơn nhiều. VieNeu xử lý giọng tiếng Việt.

## Tạo file voice

- Chọn ngôn ngữ. Tiếng Việt dùng VieNeu; English, 日本語, Español và Português dùng Chatterbox.
- Chọn file mẫu `.wav`, `.mp3`, `.m4a` hoặc `.flac` mà bạn có quyền sử dụng.
- Nhập lời trực tiếp hoặc nạp TXT. Không cần timestamp; mỗi dòng là một cue, hoặc dùng đoạn văn cách nhau bằng dòng trống. Có thể đặt `[TRANG n]` trước phần lời của trang.
- Bấm **Tạo voice clone**. Nút **Dừng tạo voice** huỷ tác vụ đang chạy; nếu có cue đã hoàn tất, có thể bấm **Tiếp tục từ cue còn thiếu**.
- Khi thành công, bấm **Lưu MP3** để chọn vị trí lưu audio.

Lựa chọn ngôn ngữ, file giọng mẫu và nội dung đang soạn được lưu cục bộ trong ứng dụng. Voice mẫu cần có nội dung đủ rõ; thời lượng và chất lượng đầu ra phụ thuộc vào engine, phần cứng và độ phù hợp của mẫu.

## Edge TTS, thư viện clone và xuất audio theo cue
- Trong cửa sổ Voice Studio, chọn **Microsoft Edge TTS** để lấy danh sách voice theo ngôn ngữ (danh sách tải từ edge-tts; cần Internet khi tổng hợp). Chọn ngôn ngữ trước, sau đó chọn một voice hiện có trong ngôn ngữ đó.
- Chọn **Voice clone** để tiếp tục dùng VieNeu/Chatterbox như trước; file mẫu WAV/MP3/M4A/FLAC vẫn được hỗ trợ. Sau khi tạo thành công, nhập tên và chọn **Lưu voice vừa tạo thành voice clone**. Voice được sao chép vào thư viện ứng dụng và có thể chọn lại ở lần chạy sau.
- Có thể nhập nội dung trực tiếp (mỗi dòng không trống là một file; các đoạn cách nhau bằng dòng trống thành cue), nạp TXT cue-form theo quy ước `[TRANG n]`, hoặc nạp SRT. Khi hoàn tất, **Lưu từng file** sẽ hỏi thư mục đích và xuất mỗi cue thành `cue-0001`, `cue-0002`, … (Edge là MP3; clone là WAV). Không ghép các cue thành một file trong chế độ này.

## Giao diện tab, nghe thử và tùy chỉnh giọng
- Voice Studio có hai tab riêng: **Edge TTS** và **Voice Clone**. Cả hai đều đọc văn bản/TXT/SRT và tạo nhiều file, còn tab Voice Clone có thêm file mẫu, ngôn ngữ clone, lưu/chọn voice clone.
- Tab Edge có ô tìm kiếm voice, ngôn ngữ tự lấy từ danh sách Edge TTS, và tùy chỉnh tốc độ, cao độ, âm lượng. Các lựa chọn tab, ngôn ngữ, voice, tìm kiếm, thiết lập đọc, nội dung và giọng clone được ghi nhớ cục bộ.
- Chọn cue trong danh sách **Chọn cue nghe thử**, rồi bấm **Nghe thử cue đang chọn** để tổng hợp và phát riêng cue đó theo voice/cài đặt hiện tại. Đây cũng là nghe thử lựa chọn voice trước khi tạo cả batch.

## Tách tab và quản lý clone
- Tab **Edge TTS** chỉ chứa danh sách Edge TTS, ngôn ngữ và tùy chọn đọc; không chứa thao tác voice clone.
- Tab **Voice Clone** chỉ chọn clone đã lưu để tạo file. Muốn tạo clone mới, bấm **Tạo voice clone mới** để mở khu vực riêng: chọn file mẫu/ngôn ngữ, nhập câu thử, tạo và nghe thử. Nút lưu chỉ mở sau khi bản nghe thử thành công; clone lưu xong xuất hiện trong thư viện để chọn ở tab Voice Clone.
- Có thể xóa clone đang chọn bằng **Xóa clone đã chọn**. Việc này xóa mục và file audio clone khỏi thư viện trên máy.

## Edge TTS – thanh trượt điều chỉnh giọng
Tab Edge TTS hiện có thanh trượt tốc độ (−50% đến +100%), cao độ (−50 đến +50 Hz), âm lượng (−50% đến +50%) và độ biểu cảm (0–100). Các giá trị được lưu riêng và gửi trực tiếp đến Edge TTS. Edge TTS không cung cấp tham số cảm xúc độc lập dùng chung cho mọi voice; thanh biểu cảm vì vậy tăng/giảm nhịp đọc và cao độ cùng nhau để tạo cảm giác bình tĩnh/tự nhiên/biểu cảm hơn.

## Sửa lỗi Chatterbox WinError 1314 trên Windows
Lỗi `A required privilege is not held by the client` xảy ra khi Hugging Face Hub tạo symbolic link trong cache model nhưng Windows chưa bật Developer Mode và Python không chạy bằng quyền Administrator. PanelVid hiện tự đặt `HF_HUB_DISABLE_SYMLINKS=1` cho tiến trình Chatterbox, để Hub lưu bản file trực tiếp trong snapshot thay vì tạo symlink; không cần bật Administrator. Cách này có thể dùng thêm dung lượng cache vì không tận dụng liên kết chia sẻ file.

Nếu lần tải trước đã để lại cache hỏng, hãy đóng PanelVid, xóa riêng thư mục `C:\Users\<tên-user>\.cache\huggingface\hub\models--ResembleAI--chatterbox` rồi mở lại và thử lại khi có Internet. Model sẽ cần tải lại. Có thể thay thế bằng bật **Developer Mode** của Windows rồi chạy lại; không khuyến nghị chạy ứng dụng thường xuyên dưới quyền Administrator.
