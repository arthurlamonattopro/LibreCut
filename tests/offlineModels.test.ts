import { describe, expect, it } from "vitest";
import { applyModelEnvironment, offlineModelFileUrl, type ModelEnvironment } from "../src/lib/offlineModels";

function blankEnvironment(): ModelEnvironment {
  return { allowLocalModels: false, allowRemoteModels: false, localModelPath: "/models/" };
}

describe("offline model configuration", () => {
  it("serves local models through the custom protocol with a remote fallback", () => {
    const environment = blankEnvironment();
    applyModelEnvironment(environment, false, "http://librecutmodel.localhost");
    expect(environment).toEqual({
      allowLocalModels: true,
      allowRemoteModels: true,
      localModelPath: "http://librecutmodel.localhost/",
    });
  });

  it("disables remote downloads in strict offline mode", () => {
    const environment = blankEnvironment();
    applyModelEnvironment(environment, true, "librecutmodel://localhost/");
    expect(environment.allowLocalModels).toBe(true);
    expect(environment.allowRemoteModels).toBe(false);
    expect(environment.localModelPath).toBe("librecutmodel://localhost/");
  });

  it("builds protocol URLs without duplicating slashes", () => {
    expect(offlineModelFileUrl("Xenova/whisper-small", "onnx/encoder_model_quantized.onnx", "http://librecutmodel.localhost/"))
      .toBe("http://librecutmodel.localhost/Xenova/whisper-small/onnx/encoder_model_quantized.onnx");
    expect(offlineModelFileUrl("/org/model", "/voices/F1.bin", "librecutmodel://localhost"))
      .toBe("librecutmodel://localhost/org/model/voices/F1.bin");
  });
});
