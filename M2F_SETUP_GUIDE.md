# Guide: Male-to-Female (M2F) Voice Conversion

Since the default voice models included in this repository (Mari, Mori Calliope, Gawr Gura, Houshou Marine, Usada Pekora) are female voices, male users will need to adjust the pitch settings in the Voice Changer client to get the best results.

**You do NOT need to train separate models for male users.** RVC models learn the target voice (the VTuber), and you simply adjust the pitch of your input voice to match.

### How to configure for Male Users:

1. Select your desired female voice model (e.g., Gawr Gura).
2. Locate the **Pitch (Tune)** or **Transpose** setting in the client interface.
3. Change the value to **`+12`**.
   - *Why?* `+12` shifts your voice up by one full octave. This naturally places a typical male voice into a standard female pitch range before the AI processes it, preventing the output from sounding deep or distorted.
4. **F0 Extraction Method:** For M2F, the `rmvpe` or `crepe` pitch extraction algorithms generally produce the smoothest results without voice cracking.
5. **Index Rate:** Keep the index rate around `0.5` to `0.7`. This ensures the AI uses the VTuber's accent and tone without completely overriding your pronunciation.

*Note: If you naturally have a higher voice, try `+8` to `+10`. If you have a very deep voice, you might need `+14` or `+16`.*