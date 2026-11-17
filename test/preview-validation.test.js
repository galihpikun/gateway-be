import test from "node:test";
import assert from "node:assert/strict";
import {validPreviewVideo,validViewPosition} from "../src/utils/previewValidation.js";
test("rejects unsupported, oversized and mislabeled preview media",()=>{
 assert.equal(validPreviewVideo({mimetype:"video/mp4",size:12,buffer:Buffer.from("not a video")}),false);
 assert.equal(validPreviewVideo({mimetype:"video/mp4",size:26*1024*1024,buffer:Buffer.from("0000ftyp")}),false);
 assert.equal(validPreviewVideo({mimetype:"video/mp4",size:8,buffer:Buffer.from("0000ftyp")}),true);
 assert.equal(validPreviewVideo(undefined),true);
 assert.equal(validViewPosition("BALCONY"),true);assert.equal(validViewPosition("seat-42"),false);
});
