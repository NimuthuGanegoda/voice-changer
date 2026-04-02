import os
import torch
import onnxruntime


class DeviceManager(object):
    _instance = None
    forceTensor: bool = False

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.gpu_num = torch.cuda.device_count()
        self.mps_enabled: bool = (
            getattr(torch.backends, "mps", None) is not None
            and torch.backends.mps.is_available()
        )

    def getDevice(self, id: int):
        if id < 0 or self.gpu_num == 0:
            if self.mps_enabled is False:
                dev = torch.device("cpu")
            else:
                dev = torch.device("mps")
        else:
            if id < self.gpu_num:
                dev = torch.device("cuda", index=id)
            else:
                print("[Voice Changer] device detection error, fallback to cpu")
                dev = torch.device("cpu")
        return dev

    def getOnnxExecutionProvider(self, gpu: int):
        availableProviders = onnxruntime.get_available_providers()
        devNum = torch.cuda.device_count()
        
        # Optimize threads for low-end / potato PCs (avoid thrashing)
        cpu_threads = max(1, min(4, os.cpu_count() // 2)) if os.cpu_count() else 2

        if gpu == 65536 and "OpenVINOExecutionProvider" in availableProviders:
            return ["OpenVINOExecutionProvider"], [{"device_type": "NPU"}]

        if gpu >= 0 and "CUDAExecutionProvider" in availableProviders and devNum > 0:
            if gpu < devNum:  # Check index here to improve error resolution
                return ["CUDAExecutionProvider"], [{"device_id": gpu}]
            else:
                print("[Voice Changer] device detection error, fallback to cpu")
                return ["CPUExecutionProvider"], [
                    {
                        "intra_op_num_threads": cpu_threads,
                        "execution_mode": onnxruntime.ExecutionMode.ORT_PARALLEL,
                        "inter_op_num_threads": cpu_threads,
                    }
                ]
        elif gpu >= 0 and "DmlExecutionProvider" in availableProviders:
            return ["DmlExecutionProvider"], [{"device_id": gpu}]
        else:
            return ["CPUExecutionProvider"], [
                {
                    "intra_op_num_threads": cpu_threads,
                    "execution_mode": onnxruntime.ExecutionMode.ORT_PARALLEL,
                    "inter_op_num_threads": cpu_threads,
                }
            ]

    def setForceTensor(self, forceTensor: bool):
        self.forceTensor = forceTensor

    def halfPrecisionAvailable(self, id: int):
        if self.gpu_num == 0:
            return False
        if id < 0:
            return False
        if self.forceTensor:
            return False

        cap = torch.cuda.get_device_capability(id)
        if cap[0] < 7:  # Half precision generally requires compute capability 7 or higher (with some exceptions like T500)
            return False

        return True

    def getDeviceMemory(self, id: int):
        try:
            return torch.cuda.get_device_properties(id).total_memory
        except Exception as e:
            print(e)
            return 0
