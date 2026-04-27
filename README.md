# GitHub Pages Video Compressor
yo wasm.

A simple ffmpeg.wasm video compressor that can be published directly with GitHub Pages.

## Usage

1. Select a video file, or drag and drop one onto the page.
2. Choose quality, max width, and audio bitrate settings.
3. Click `Compress`.
4. When compression finishes, save the compressed MP4 from `Download`.

Videos are processed in the browser and are not uploaded to a server.

## Publish With GitHub Pages

1. Push this repository to GitHub.
2. Open `Settings` -> `Pages` in the GitHub repository.
3. Set `Build and deployment` -> `Source` to `Deploy from a branch`.
4. Select the `main` branch and `/root`.

## Local Preview

Use a local server instead of opening the file with `file://`, because the app uses ES Modules and WebAssembly.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Notes

- The first run downloads the ffmpeg.wasm core from a CDN, which is about 30 MB.
- Large or long videos can take a while depending on the device's CPU and memory.
- GitHub Pages cannot easily set custom headers, so this app uses the single-threaded core instead of the multi-threaded build that requires SharedArrayBuffer.
