import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";

const fumadocsSource = docs.toFumadocsSource();

// fumadocs-mdx returns files as a lazy function, but loader() expects an array
const files =
  typeof fumadocsSource.files === "function"
    ? (fumadocsSource.files as unknown as () => typeof fumadocsSource.files)()
    : fumadocsSource.files;

export const source = loader({
  source: { ...fumadocsSource, files },
  baseUrl: "/docs",
});
