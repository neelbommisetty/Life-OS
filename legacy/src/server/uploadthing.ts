import { createUploadthing, type FileRouter } from "uploadthing/next";

const f = createUploadthing();

export const uploadRouter = {
  artifactFile: f({
    image: { maxFileSize: "16MB", maxFileCount: 1 },
    blob: { maxFileSize: "16MB", maxFileCount: 1 },
  }).onUploadComplete(({ file }) => {
    return {
      key: file.key,
      url: file.url,
      name: file.name,
      size: file.size,
      type: file.type,
    };
  }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
