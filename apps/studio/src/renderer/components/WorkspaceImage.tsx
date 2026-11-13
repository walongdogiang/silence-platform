import { useEffect, useState } from "react";
import { imageRefsIn, readWorkspaceImage } from "../workspaceImages";
import type { EditTarget } from "../imageActions";
import { useT } from "../i18n";
import { ImageFrame } from "./ImageFrame";

type Loaded = { path: string; url: string };

/** Đọc ảnh workspace qua Engine; lỗi (không tồn tại, quá lớn, ngoài workspace) → `null`. */
function useWorkspaceImages(workspace: string | undefined, paths: string[]): Loaded[] | null {
  const key = paths.join("\n");
  const [state, setState] = useState<Loaded[] | null>(null);
  useEffect(() => {
    if (!workspace || !key) {
      setState([]);
      return;
    }
    let alive = true;
    setState(null);
    void Promise.all(
      key.split("\n").map((p) =>
        readWorkspaceImage(workspace, p).then(
          (r): Loaded => ({ path: r.path, url: r.data_url }),
          () => null,
        ),
      ),
    ).then((xs) => {
      if (alive) setState(xs.filter((x): x is Loaded => x !== null));
    });
    return () => {
      alive = false;
    };
  }, [workspace, key]);
  return state;
}

/** Ảnh Markdown `![alt](path)` trỏ vào workspace: hiện tại chỗ, bấm để phóng to. */
export function WorkspaceImage(props: {
  workspace?: string;
  path: string;
  alt?: string;
  onOpen?: (images: string[], index: number) => void;
  onEdit?: (target: EditTarget) => void;
}) {
  const t = useT();
  const loaded = useWorkspaceImages(props.workspace, [props.path]);
  if (loaded === null) return <span className="md-img-loading">{t("md.imgLoading", { path: props.path })}</span>;
  const img = loaded[0];
  if (!img) return <span className="md-img-blocked">{t("md.imgFailed", { path: props.path })}</span>;
  return (
    <ImageFrame
      className="md-img"
      src={img.url}
      alt={props.alt || img.path}
      path={img.path}
      title={t("md.imgZoom", { path: img.path })}
      onOpen={() => props.onOpen?.([img.url], 0)}
      onEdit={props.onEdit ? () => props.onEdit?.({ src: img.url, path: img.path }) : undefined}
    />
  );
}

/**
 * Dải xem trước dưới câu trả lời: ảnh workspace mà agent nhắc tới (file nó vừa tạo…).
 * Ảnh không đọc được (chưa tồn tại, đang chờ Apply) thì bỏ qua, không báo lỗi.
 */
export function ImageRefStrip(props: {
  workspace?: string;
  text: string;
  onOpen?: (images: string[], index: number) => void;
  onEdit?: (target: EditTarget) => void;
}) {
  const t = useT();
  const paths = imageRefsIn(props.text);
  const loaded = useWorkspaceImages(props.workspace, paths);
  if (!loaded?.length) return null;
  const urls = loaded.map((x) => x.url);
  return (
    <div className="msg-ref-images">
      {loaded.map((img, i) => (
        <figure key={img.path}>
          <ImageFrame
            src={img.url}
            alt={img.path}
            path={img.path}
            title={t("md.imgZoom", { path: img.path })}
            onOpen={() => props.onOpen?.(urls, i)}
            onEdit={props.onEdit ? () => props.onEdit?.({ src: img.url, path: img.path }) : undefined}
          />
          <figcaption>{img.path}</figcaption>
        </figure>
      ))}
    </div>
  );
}
