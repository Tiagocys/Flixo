import os
import random
import re
import threading
from typing import List
from urllib.parse import urlencode

import requests
from loguru import logger
from moviepy.video.VideoClip import ImageClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from moviepy.video.io.VideoFileClip import VideoFileClip

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect, VideoConcatMode
from app.utils import utils

# Thread-safe counter for API key rotation
_api_key_counter = 0
_api_key_lock = threading.Lock()
_SENSITIVE_QUERY_RE = re.compile(
    r"([?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=)([^&#\s]+)",
    re.IGNORECASE,
)


def _get_tls_verify() -> bool:
    # 默认开启 TLS 证书校验，防止素材搜索和下载过程被中间人篡改。
    # 仅在企业代理、自签证书等明确需要的场景下，允许用户通过
    # `config.toml` 显式设置 `tls_verify = false` 临时关闭。
    tls_verify = config.app.get("tls_verify", True)
    if isinstance(tls_verify, str):
        tls_verify = tls_verify.strip().lower() not in ("0", "false", "no", "off")

    if not tls_verify:
        logger.warning(
            "TLS certificate verification is disabled by config.app.tls_verify=false. "
            "Only use this in trusted proxy environments."
        )

    return bool(tls_verify)


def _redact_url(url: str) -> str:
    return _SENSITIVE_QUERY_RE.sub(r"\1***", url)


def get_api_key(cfg_key: str):
    api_keys = config.app.get(cfg_key)
    if not api_keys:
        raise ValueError(
            f"\n\n##### {cfg_key} is not set #####\n\nPlease set it in the config.toml file: {config.config_file}\n\n"
            f"{utils.to_json(config.app)}"
        )

    # if only one key is provided, return it
    if isinstance(api_keys, str):
        return api_keys

    global _api_key_counter
    with _api_key_lock:
        _api_key_counter += 1
        return api_keys[_api_key_counter % len(api_keys)]


def search_videos_pexels(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)
    video_orientation = aspect.name
    video_width, video_height = aspect.to_resolution()
    api_key = get_api_key("pexels_api_keys")
    headers = {
        "Authorization": api_key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    }
    # Build URL
    params = {"query": search_term, "per_page": 20, "orientation": video_orientation}
    query_url = f"https://api.pexels.com/videos/search?{urlencode(params)}"
    logger.info(f"searching videos: {_redact_url(query_url)}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
        )
        response = r.json()
        video_items = []
        if "videos" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["videos"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["video_files"]
            # loop through each url to determine the best quality
            for video in video_files:
                w = int(video["width"])
                h = int(video["height"])
                if w == video_width and h == video_height:
                    item = MaterialInfo()
                    item.provider = "pexels"
                    item.url = video["link"]
                    item.duration = duration
                    video_items.append(item)
                    break
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def search_videos_pixabay(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_type: str = "all",
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)

    video_width, video_height = aspect.to_resolution()

    api_key = get_api_key("pixabay_api_keys")
    # Build URL
    params = {
        "q": search_term,
        "video_type": video_type,  # Accepted values: "all", "film", "animation"
        "per_page": 50,
        "key": api_key,
    }
    query_url = f"https://pixabay.com/api/videos/?{urlencode(params)}"
    logger.info(f"searching videos: {_redact_url(query_url)}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url, proxies=config.proxy, verify=_get_tls_verify(), timeout=(30, 60)
        )
        response = r.json()
        video_items = []
        if "hits" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["hits"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["videos"]
            preferred_candidates = []
            fallback_candidates = []
            for quality_index, quality in enumerate(("small", "medium", "tiny", "large")):
                video = video_files.get(quality)
                if not video:
                    continue
                w = int(video.get("width") or 0)
                h = int(video.get("height") or 0)
                if w <= 0 or h <= 0:
                    continue
                same_orientation = (
                    (video_width >= video_height and w >= h)
                    or (video_width < video_height and w < h)
                    or (video_width == video_height)
                )
                # Keep Pixabay economical: prefer small/medium and same orientation.
                # Only fall back to large when the API does not expose a smaller file.
                size = int(video.get("size") or 0)
                candidate = (0 if same_orientation else 1, quality_index, size, video)
                if quality == "large":
                    fallback_candidates.append(candidate)
                else:
                    preferred_candidates.append(candidate)
            candidates = preferred_candidates or fallback_candidates
            if not candidates:
                continue
            *_, selected = sorted(candidates, key=lambda item: item[:3])[0]
            item = MaterialInfo()
            item.provider = "pixabay"
            item.url = selected["url"]
            item.duration = duration
            video_items.append(item)
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def _image_orientation(video_aspect: VideoAspect = VideoAspect.portrait) -> str:
    aspect = VideoAspect(video_aspect)
    if aspect == VideoAspect.landscape:
        return "horizontal"
    if aspect == VideoAspect.square:
        return "all"
    return "vertical"


def search_images_pexels(
    search_term: str,
    video_aspect: VideoAspect = VideoAspect.portrait,
    media_style: str = "all",
) -> List[MaterialInfo]:
    api_key = get_api_key("pexels_api_keys")
    headers = {
        "Authorization": api_key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    }
    query = search_term
    if media_style == "animation":
        query = f"{search_term} cartoon illustration"
    params = {
        "query": query,
        "per_page": 20,
        "orientation": _image_orientation(video_aspect),
    }
    query_url = f"https://api.pexels.com/v1/search?{urlencode(params)}"
    logger.info(f"searching images: {_redact_url(query_url)}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
        )
        response = r.json()
        image_items: List[MaterialInfo] = []
        if "photos" not in response:
            logger.error(f"search images failed: {response}")
            return image_items
        for photo in response["photos"]:
            src = photo.get("src") or {}
            image_url = src.get("large2x") or src.get("large") or src.get("original")
            if not image_url:
                continue
            item = MaterialInfo()
            item.provider = "pexels"
            item.url = image_url
            item.duration = 0
            image_items.append(item)
        return image_items
    except Exception as e:
        logger.error(f"search images failed: {str(e)}")

    return []


def search_images_pixabay(
    search_term: str,
    video_aspect: VideoAspect = VideoAspect.portrait,
    media_style: str = "all",
) -> List[MaterialInfo]:
    api_key = get_api_key("pixabay_api_keys")
    image_type = "all"
    query = search_term
    if media_style == "animation":
        image_type = "illustration"
        query = f"{search_term} cartoon"
    elif media_style == "realistic":
        image_type = "photo"

    params = {
        "q": query,
        "image_type": image_type,  # all, photo, illustration, vector
        "orientation": _image_orientation(video_aspect),
        "per_page": 50,
        "safesearch": "true",
        "key": api_key,
    }
    query_url = f"https://pixabay.com/api/?{urlencode(params)}"
    logger.info(f"searching images: {_redact_url(query_url)}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url, proxies=config.proxy, verify=_get_tls_verify(), timeout=(30, 60)
        )
        response = r.json()
        image_items: List[MaterialInfo] = []
        if "hits" not in response:
            logger.error(f"search images failed: {response}")
            return image_items
        for hit in response["hits"]:
            image_url = hit.get("webformatURL") or hit.get("largeImageURL")
            if not image_url:
                continue
            item = MaterialInfo()
            item.provider = "pixabay"
            item.url = image_url
            item.duration = 0
            image_items.append(item)
        return image_items
    except Exception as e:
        logger.error(f"search images failed: {str(e)}")

    return []


def search_videos_coverr(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    """
    Coverr (https://coverr.co) - free HD/4K stock videos,
    subject to Coverr license terms (https://coverr.co/license).

    Coverr API notes (based on official docs at api.coverr.co/docs/):
      - 鉴权: Authorization: Bearer <api_key>
      - 搜索端点: GET /videos?query=...,响应结构 {"hits": [...], ...}
      - 加 ?urls=true 在搜索响应里直接返回 mp4 直链
      - URL 是 signed JWT(绑定 API key,无过期时间)
      - Coverr 库以 16:9 横屏为主,9:16 portrait 占比极低(约 1%)
        因此本函数不做 aspect_ratio 过滤,由下游 video.py 的
        resize + letterbox 逻辑统一处理
      - duration 字段同时存在 number 和 string 两种形态,本函数都接受

    本函数使用 urls.mp4_download 字段作为下载地址 —— 按 Coverr 官方文档
    (https://api.coverr.co/docs/videos/#download-a-video) 的说法,
    GET 这个 URL 本身就被 Coverr 当作一次合法的 download 事件计入统计,
    无需再调用 PATCH /videos/:id/stats/downloads。
    """
    api_key = get_api_key("coverr_api_keys")
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {
        "query": search_term,
        "page_size": 20,
        "urls": "true",
        "sort": "popular",
    }
    query_url = f"https://api.coverr.co/videos?{urlencode(params)}"
    logger.info(f"searching videos: {_redact_url(query_url)}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
        )
        response = r.json()
        video_items: List[MaterialInfo] = []

        if not isinstance(response, dict) or "hits" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items

        for v in response["hits"]:
            # duration 在不同响应里可能是 number(11.625) 或 string("10.500000")
            try:
                duration = int(float(v.get("duration") or 0))
            except (TypeError, ValueError):
                continue
            if duration < minimum_duration:
                continue

            video_id = v.get("id")
            mp4_download_url = (v.get("urls") or {}).get("mp4_download")
            if not video_id or not mp4_download_url:
                continue

            item = MaterialInfo()
            item.provider = "coverr"
            item.url = mp4_download_url
            item.duration = duration
            video_items.append(item)
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def save_video(video_url: str, save_dir: str = "") -> str:
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")

    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    url_without_query = video_url.split("?")[0]
    url_hash = utils.md5(url_without_query)
    video_id = f"vid-{url_hash}"
    video_path = f"{save_dir}/{video_id}.mp4"

    # if video already exists, return the path
    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        logger.info(f"video already exists: {video_path}")
        return video_path

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    # if video does not exist, download it
    with open(video_path, "wb") as f:
        f.write(
            requests.get(
                video_url,
                headers=headers,
                proxies=config.proxy,
                verify=_get_tls_verify(),
                timeout=(60, 240),
            ).content
        )

    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        clip = None
        try:
            clip = VideoFileClip(video_path)
            duration = clip.duration
            fps = clip.fps
            if duration > 0 and fps > 0:
                return video_path
        except Exception as e:
            logger.warning(f"invalid video file: {video_path} => {str(e)}")
            try:
                os.remove(video_path)
            except Exception as remove_error:
                logger.warning(
                    f"failed to remove invalid video file: {video_path}, error: {str(remove_error)}"
                )
        finally:
            if clip is not None:
                try:
                    clip.close()
                except Exception as close_error:
                    logger.warning(
                        f"failed to close video clip: {video_path}, error: {str(close_error)}"
                    )
    return ""


def save_image_as_video(
    image_url: str,
    save_dir: str = "",
    clip_duration: int = 5,
) -> str:
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")

    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    url_without_query = image_url.split("?")[0]
    url_hash = utils.md5(url_without_query)
    image_path = f"{save_dir}/img-{url_hash}.jpg"
    video_path = f"{save_dir}/img-{url_hash}.mp4"

    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        logger.info(f"image video already exists: {video_path}")
        return video_path

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    if not os.path.exists(image_path) or os.path.getsize(image_path) == 0:
        with open(image_path, "wb") as f:
            f.write(
                requests.get(
                    image_url,
                    headers=headers,
                    proxies=config.proxy,
                    verify=_get_tls_verify(),
                    timeout=(60, 180),
                ).content
            )

    if not os.path.exists(image_path) or os.path.getsize(image_path) == 0:
        return ""

    clip = None
    final_clip = None
    try:
        clip = ImageClip(image_path).with_duration(clip_duration).with_position("center")
        zoom_clip = clip.resized(
            lambda t: 1 + (clip_duration * 0.03) * (t / clip.duration)
        )
        final_clip = CompositeVideoClip([zoom_clip])
        final_clip.write_videofile(video_path, fps=30, logger=None)
        logger.success(f"image converted to video: {video_path}")
        return video_path if os.path.exists(video_path) and os.path.getsize(video_path) > 0 else ""
    except Exception as e:
        logger.error(f"failed to convert image to video: {image_url} => {str(e)}")
        try:
            if os.path.exists(video_path):
                os.remove(video_path)
        except Exception:
            pass
        return ""
    finally:
        if clip is not None:
            try:
                clip.close()
            except Exception:
                pass
        if final_clip is not None:
            try:
                final_clip.close()
            except Exception:
                pass


def download_videos(
    task_id: str,
    search_terms: List[str],
    source: str = "pexels",
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_concat_mode: VideoConcatMode = VideoConcatMode.random,
    audio_duration: float = 0.0,
    max_clip_duration: int = 5,
    match_script_order: bool = False,
    media_mode: str = "videos",
    media_style: str = "all",
) -> List[str]:
    media_mode = str(media_mode or "videos").lower()
    media_style = str(media_style or "all").lower()
    if media_mode not in ("videos", "images", "mixed"):
        media_mode = "videos"
    if media_style not in ("all", "realistic", "animation"):
        media_style = "all"

    pixabay_video_type = "animation" if media_style == "animation" else "film" if media_style == "realistic" else "all"

    def search_videos(search_term: str, minimum_duration: int, video_aspect: VideoAspect):
        if source == "pixabay":
            return search_videos_pixabay(
                search_term=search_term,
                minimum_duration=minimum_duration,
                video_aspect=video_aspect,
                video_type=pixabay_video_type,
            )
        if source == "coverr":
            return search_videos_coverr(
                search_term=search_term,
                minimum_duration=minimum_duration,
                video_aspect=video_aspect,
            )
        query = f"{search_term} animation cartoon" if media_style == "animation" else search_term
        return search_videos_pexels(
            search_term=query,
            minimum_duration=minimum_duration,
            video_aspect=video_aspect,
        )

    def search_images(search_term: str, video_aspect: VideoAspect):
        if source == "pixabay":
            return search_images_pixabay(
                search_term=search_term,
                video_aspect=video_aspect,
                media_style=media_style,
            )
        return search_images_pexels(
            search_term=search_term,
            video_aspect=video_aspect,
            media_style=media_style,
        )

    # Pure video mode can use the existing ordered downloader. Image/mixed modes
    # need the same script-order behavior but a different save path for images.
    if match_script_order and media_mode == "videos":
        material_directory = config.app.get("material_directory", "").strip()
        if material_directory == "task":
            material_directory = utils.task_dir(task_id)
        elif material_directory and not os.path.isdir(material_directory):
            material_directory = ""
        return _download_videos_by_script_order(
            task_id=task_id,
            search_terms=search_terms,
            search_videos=search_videos,
            video_aspect=video_aspect,
            audio_duration=audio_duration,
            max_clip_duration=max_clip_duration,
            material_directory=material_directory,
        )

    material_directory = config.app.get("material_directory", "").strip()
    if material_directory == "task":
        material_directory = utils.task_dir(task_id)
    elif material_directory and not os.path.isdir(material_directory):
        material_directory = ""

    valid_video_items = []
    candidate_groups = []
    valid_video_urls = set()
    found_duration = 0.0
    for search_term in search_terms:
        video_items = []
        image_items = []
        if media_mode in ("videos", "mixed"):
            video_items = search_videos(
                search_term=search_term,
                minimum_duration=max_clip_duration,
                video_aspect=video_aspect,
            )
        if media_mode in ("images", "mixed") and source != "coverr":
            image_items = search_images(
                search_term=search_term,
                video_aspect=video_aspect,
            )
        logger.info(
            f"found {len(video_items)} videos and {len(image_items)} images for '{search_term}'"
        )

        term_items = []
        for item in [*video_items, *image_items]:
            if item.url not in valid_video_urls:
                term_items.append(item)
                valid_video_urls.add(item.url)
                found_duration += item.duration or max_clip_duration
        if match_script_order and term_items:
            candidate_groups.append((search_term, term_items))
        else:
            valid_video_items.extend(term_items)

    if match_script_order and candidate_groups:
        valid_video_items = []
        selected_duration = 0.0
        candidate_index = 0
        while candidate_groups and selected_duration <= audio_duration:
            has_candidate = False
            for search_term, term_items in candidate_groups:
                if candidate_index >= len(term_items):
                    continue
                has_candidate = True
                item = term_items[candidate_index]
                valid_video_items.append(item)
                selected_duration += item.duration or max_clip_duration
                if selected_duration > audio_duration:
                    break
            if not has_candidate:
                break
            candidate_index += 1

    logger.info(
        f"found total media: {len(valid_video_items)}, required duration: {audio_duration} seconds, found duration: {found_duration} seconds"
    )
    video_paths = []

    concat_mode_value = getattr(video_concat_mode, "value", video_concat_mode)
    if concat_mode_value == VideoConcatMode.random.value and not match_script_order:
        random.shuffle(valid_video_items)

    total_duration = 0.0
    for item in valid_video_items:
        try:
            logger.info(f"downloading media: {item.url}")
            is_image = not item.duration
            saved_video_path = (
                save_image_as_video(
                    image_url=item.url,
                    save_dir=material_directory,
                    clip_duration=max_clip_duration,
                )
                if is_image
                else save_video(video_url=item.url, save_dir=material_directory)
            )
            if saved_video_path:
                logger.info(f"media saved: {saved_video_path}")
                video_paths.append(saved_video_path)
                seconds = min(max_clip_duration, item.duration or max_clip_duration)
                total_duration += seconds
                if total_duration > audio_duration:
                    logger.info(
                        f"total duration of downloaded videos: {total_duration} seconds, skip downloading more"
                    )
                    break
        except Exception as e:
            logger.error(f"failed to download video: {utils.to_json(item)} => {str(e)}")
    logger.success(f"downloaded {len(video_paths)} videos")
    return video_paths


def _download_videos_by_script_order(
    task_id: str,
    search_terms: List[str],
    search_videos,
    video_aspect: VideoAspect,
    audio_duration: float,
    max_clip_duration: int,
    material_directory: str,
) -> List[str]:
    """
    按脚本文案顺序下载素材。

    默认下载逻辑会把所有关键词的候选素材合并成一个大列表；如果第一个
    关键词返回很多结果，最终下载时可能一直消耗这个关键词的素材，后续
    脚本主题就排不上时间线。这里按关键词分组后轮询下载：
    第 1 轮取每个关键词的第 1 个候选，第 2 轮取每个关键词的第 2 个候选。
    这样在不重写视频合成引擎的前提下，尽量保证素材顺序贴近文案顺序。
    """
    logger.info("downloading videos with script-order material matching")
    candidate_groups = []
    valid_video_urls = set()
    found_duration = 0.0

    for search_term in search_terms:
        video_items = search_videos(
            search_term=search_term,
            minimum_duration=max_clip_duration,
            video_aspect=video_aspect,
        )
        logger.info(f"found {len(video_items)} videos for '{search_term}'")

        term_items = []
        for item in video_items:
            if item.url in valid_video_urls:
                continue
            term_items.append(item)
            valid_video_urls.add(item.url)
            found_duration += item.duration

        if term_items:
            candidate_groups.append((search_term, term_items))

    logger.info(
        f"found total ordered video candidates: {sum(len(items) for _, items in candidate_groups)}, "
        f"required duration: {audio_duration} seconds, found duration: {found_duration} seconds"
    )

    video_paths = []
    total_duration = 0.0
    candidate_index = 0
    while candidate_groups and total_duration <= audio_duration:
        has_candidate = False
        for search_term, term_items in candidate_groups:
            if candidate_index >= len(term_items):
                continue

            has_candidate = True
            item = term_items[candidate_index]
            try:
                logger.info(
                    f"downloading ordered video for '{search_term}': {item.url}"
                )
                saved_video_path = save_video(
                    video_url=item.url, save_dir=material_directory
                )
                if saved_video_path:
                    logger.info(f"video saved: {saved_video_path}")
                    video_paths.append(saved_video_path)
                    total_duration += min(max_clip_duration, item.duration)
                    if total_duration > audio_duration:
                        logger.info(
                            f"total duration of downloaded videos: {total_duration} seconds, skip downloading more"
                        )
                        break
            except Exception as e:
                logger.error(
                    f"failed to download ordered video: {utils.to_json(item)} => {str(e)}"
                )

        if not has_candidate:
            break
        candidate_index += 1

    logger.success(f"downloaded {len(video_paths)} ordered videos")
    return video_paths


if __name__ == "__main__":
    download_videos(
        "test123", ["Money Exchange Medium"], audio_duration=100, source="pixabay"
    )
