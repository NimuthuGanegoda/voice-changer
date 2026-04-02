# VCClient (Voice Changer Client)

VCClient is software that performs real-time voice conversion using AI.

[English](/README.md) / [Japanese](/docs_i18n/README_ja.md) / [Korean](/docs_i18n/README_ko.md) / [Chinese](/docs_i18n/README_zh.md)

## What's New!

- **v.2.2.2-beta**
  - Release Editions: std_win, std_mac, std_lin_aarch64
  - Support for Beatrice v2.0.0-rc0.
  - Optimized for low-end devices with bundle size reduction.

## Key Features

- **Real-time Voice Conversion**: Convert your voice in real-time using advanced AI models like RVC and Beatrice.
- **Cross-Platform Support**: Runs on Windows, Mac (M1/M2), Linux, and Google Colab.
- **Network Mode**: Offload the processing to another PC or server to save local resources for gaming or other tasks.
- **REST API Support**: Integrate the voice changer into your own applications using the provided REST API.

## Supported AI Models

| AI Model | v2 | v1 | License |
| --- | --- | --- | --- |
| [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | Supported | Supported | Check repository |
| [Beatrice v2](https://prj-beatrice.com/) | Supported | N/A | [Proprietary](https://huggingface.co/wok000/vcclient_model/blob/main/beatrice_v2_beta/readme.md) |
| [Beatrice v1](https://prj-beatrice.com/) | N/A | Supported (Win) | Proprietary |

## Setup for Male Users (M2F)

If you are a male user wanting to use female VTuber voices (like Mori Calliope or Gawr Gura), please check our [**M2F Setup Guide**](M2F_SETUP_GUIDE.md).
Summary: Set **Pitch (Tune)** to **`+12`** for the best results!

## Optimized Build for Low-End Devices

For users with limited hardware (2GB RAM, slow CPU), we provide an optimized build of the recorder:
1. Navigate to the `recorder` directory.
2. Run `npm run build:optimized-entry`.
3. Follow the instructions in [LOW_END_OPTIMIZATION_README.md](recorder/LOW_END_OPTIMIZATION_README.md).

## Troubleshooting

- [Communication Troubleshooting](tutorials/trouble_shoot_communication_ja.md) (Japanese)

## Disclaimer

We are not responsible for any direct, indirect, consequential, or special damages arising from the use or inability to use this software. Use at your own risk.

---

### Acknowledgments

- [Tsukuyomi-chan](https://tyc.rei-yumesaki.net/)
- [Amitaro's Voice Material Studio](https://amitaro.net/)
- [Replica Doll](https://kikyohiroto1227.wixsite.com/kikoto-utau)
