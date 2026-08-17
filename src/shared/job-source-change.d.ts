import "@/shared/types";

declare module "@/shared/types" {
  interface Job {
    /** True after an already-analyzed source set is changed, until VALIDATE succeeds again. */
    video_sources_changed?: boolean;
  }
}
