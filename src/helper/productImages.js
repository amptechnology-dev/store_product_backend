const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { uploadToR2 } = require("./upload.js");

// system ffmpeg use korte chaile .env te FFMPEG_PATH dao
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegPath);

// ---------- GIF settings ----------
const GIF_MAX_SECONDS = 6;
const GIF_FPS = 10;
const GIF_WIDTH = 480;
const FFMPEG_TIMEOUT_MS = 60 * 1000;
const MAX_PARALLEL_CONVERSIONS = 2;

// ---------- Banner size limits (convert er age original file er upor) ----------
const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_BANNER_VIDEO_SIZE = 30 * 1024 * 1024; // 30MB

// ---------- simple limiter (server er CPU bachate) ----------
let running = 0;
const waiting = [];

const acquireSlot = () => {
  if (running < MAX_PARALLEL_CONVERSIONS) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
};

const releaseSlot = () => {
  const next = waiting.shift();
  if (next)
    next(); // slot ta shorasori porer jon ke dao
  else running--;
};

const sanitizeName = (name = "") =>
  path
    .basename(name, path.extname(name))
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 50);

const buildFileName = (folder, file) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mediaFolder = file.mimetype.startsWith("video/") ? "videos" : "images";
  return `${folder}/${mediaFolder}/${Date.now()}-${Math.round(
    Math.random() * 1e9,
  )}-${sanitizeName(file.originalname)}${ext}`;
};

const isVideoFile = (file) => file.mimetype.startsWith("video/");

// video buffer -> gif buffer
const convertVideoToGifBuffer = async (file) => {
  const id = crypto.randomUUID();
  const inputExt = path.extname(file.originalname).toLowerCase() || ".mp4";
  const inputPath = path.join(os.tmpdir(), `${id}${inputExt}`);
  const outputPath = path.join(os.tmpdir(), `${id}.gif`);

  try {
    await fs.writeFile(inputPath, file.buffer);

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn) => (arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const command = ffmpeg(inputPath)
        .noAudio()
        .duration(GIF_MAX_SECONDS)
        .outputOptions([
          "-vf",
          `fps=${GIF_FPS},scale='min(${GIF_WIDTH},iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
          "-loop",
          "0", // infinite loop
        ])
        .format("gif")
        .on("end", done(resolve))
        .on("error", done(reject));

      const timer = setTimeout(() => {
        command.kill("SIGKILL");
        done(reject)(new Error("ffmpeg timeout"));
      }, FFMPEG_TIMEOUT_MS);

      command.save(outputPath);
    });

    return await fs.readFile(outputPath);
  } catch (error) {
    console.error("Video to GIF conversion failed:", error.message);
    const err = new Error(
      "Video could not be converted to GIF. Please try a different file",
    );
    err.statusCode = 400;
    throw err;
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

// image hole ja ache tai, video hole gif file object baniye dey
const prepareMediaFile = async (file) => {
  if (!isVideoFile(file)) return file;

  await acquireSlot();
  try {
    const gifBuffer = await convertVideoToGifBuffer(file);
    return {
      ...file,
      buffer: gifBuffer,
      size: gifBuffer.length,
      mimetype: "image/gif",
      originalname: `${sanitizeName(file.originalname)}.gif`,
    };
  } finally {
    releaseSlot();
  }
};

// product + banner duto-r jonno common upload (video hole GIF hoye jay)
const uploadPreparedFile = async (folder, file) => {
  const prepared = await prepareMediaFile(file);
  return uploadToR2(
    prepared.buffer,
    buildFileName(folder, prepared),
    prepared.mimetype,
  );
};

const uploadSimpleImages = async (files = []) => {
  if (!files?.length) return [];

  const mediaFiles = files
    .filter((f) => /^image\d+$/.test(f.fieldname))
    // fieldname er number diye order thik rakhi
    .sort(
      (a, b) =>
        Number(a.fieldname.replace("image", "")) -
        Number(b.fieldname.replace("image", "")),
    );
  if (!mediaFiles.length) return [];

  return Promise.all(
    mediaFiles.map((file) => uploadPreparedFile("products", file)),
  );
};

const uploadVariantImages = async (files = []) => {
  if (!files?.length) return {};

  const variantFiles = files.filter((f) =>
    /^variantImage_\d+$/.test(f.fieldname),
  );
  if (!variantFiles.length) return {};

  const uploaded = await Promise.all(
    variantFiles.map(async (file) => {
      const idx = file.fieldname.split("_")[1];
      const url = await uploadPreparedFile("products/variants", file);
      return { idx, url };
    }),
  );

  return uploaded.reduce((map, { idx, url }) => {
    (map[idx] ||= []).push(url);
    return map;
  }, {});
};

const uploadBannerMedia = async (files = []) => {
  const file = files.find((f) => ["media", "image"].includes(f.fieldname));
  if (!file) return null;

  const isVideo = isVideoFile(file);
  const maxSize = isVideo ? MAX_BANNER_VIDEO_SIZE : MAX_BANNER_IMAGE_SIZE;

  if (file.size > maxSize) {
    const err = new Error(
      `${isVideo ? "Video" : "Image"} must be under ${maxSize / 1024 / 1024}MB`,
    );
    err.statusCode = 400;
    throw err;
  }

  const url = await uploadPreparedFile("amp-store/banner", file);

  return { url, mediaType: "image" };
};

const uploadAdsMedia = async (files = []) => {
  const file = files.find((f) =>
    ["media", "video", "image"].includes(f.fieldname),
  );
  if (!file) return null;

  const isVideo = isVideoFile(file);
  const maxSize = isVideo ? MAX_BANNER_VIDEO_SIZE : MAX_BANNER_IMAGE_SIZE;

  if (file.size > maxSize) {
    const err = new Error(
      `${isVideo ? "Video" : "Image"} must be under ${maxSize / 1024 / 1024}MB`,
    );
    err.statusCode = 400;
    throw err;
  }

  const url = await uploadPreparedFile("amp-store/ads", file);

  return { url, mediaType: "gif" };
};

module.exports = {
  uploadSimpleImages,
  uploadVariantImages,
  uploadBannerMedia,
  uploadAdsMedia,
};
