#include <stdint.h>
#include <stdbool.h>

#ifdef __wasm__
#define WASM_EXPORT __attribute__((visibility("default")))
#else
#define WASM_EXPORT
#endif

// ============================================================================
// C64 / 6510 / VIC-II / MOS 6581-8580 SID WebAssembly Core
// Designed for Martin Galway's 1985-1987 Ocean Software Audio Source Files
// ============================================================================

#define PAL_CLOCK_HZ   985248
#define NTSC_CLOCK_HZ  1022727

#define PAL_LINES      312
#define PAL_CYCLES_LINE 63

#define NTSC_LINES     263
#define NTSC_CYCLES_LINE 65

#define FLAG_C 0x01
#define FLAG_Z 0x02
#define FLAG_I 0x04
#define FLAG_D 0x08
#define FLAG_B 0x10
#define FLAG_U 0x20
#define FLAG_V 0x40
#define FLAG_N 0x80

enum {
    ENV_IDLE = 0,
    ENV_ATTACK = 1,
    ENV_DECAY = 2,
    ENV_RELEASE = 3
};

typedef struct {
    uint32_t phase;
    uint32_t lfsr;
    uint16_t freq;
    uint16_t pw;
    uint8_t  control;
    uint8_t  attack;
    uint8_t  decay;
    uint8_t  sustain;
    uint8_t  release;

    uint8_t  env_level;
    uint8_t  env_state;
    uint16_t rate_counter;
    uint8_t  exp_counter;
    uint8_t  hold_zero;

    float    last_out;
} SidVoice;

// Exported / Shared State
static uint8_t  ram[65536];
static uint8_t  sid_regs[32];
static uint8_t  scanline_border[312];

// Audio & Oscilloscope Output Buffers (4096 samples max per render call)
#define MAX_AUDIO_FRAMES 4096
static float    audio_out_l[MAX_AUDIO_FRAMES];
static float    audio_out_r[MAX_AUDIO_FRAMES];
static float    voice_scope[4][512]; // 0,1,2 = SID voices, 3 = Digi/Master mix
static uint32_t scope_write_pos = 0;

// CPU State
static uint16_t cpu_pc = 0x1000;
static uint8_t  cpu_a = 0;
static uint8_t  cpu_x = 0;
static uint8_t  cpu_y = 0;
static uint8_t  cpu_sp = 0xFD;
static uint8_t  cpu_p = FLAG_U | FLAG_I;
static uint64_t total_cycles = 0;
static uint32_t frame_count = 0;
static uint8_t  cpu_jammed = 0;

// VIC-II Raster & Interrupt State
static uint8_t  is_ntsc = 0;
static uint16_t vic_line = 0;
static uint16_t vic_line_cycle = 0;
static uint16_t vic_irq_line = 0x1FF;
static uint8_t  vic_irq_status = 0;
static uint8_t  vic_irq_enable = 0;
static uint8_t  border_color = 0;

// KERNAL / Driver Key Injection & Hooks
static uint8_t  pending_key = 0;
static uint16_t custom_keyscan_addr = 0;

// SID State
static SidVoice voices[3];
static uint16_t filter_fc = 0;
static uint8_t  filter_res = 0;
static uint8_t  filter_routing = 0;
static uint8_t  filter_mode = 0;
static uint8_t  master_vol = 15;
static uint8_t  sid_model_8580 = 0; // 0 = 6581, 1 = 8580
static uint8_t  voice_mute_mask = 0; // bit 0..2 = Voice 0..2, bit 3 = Digi

static float    filter_bp = 0.0f;
static float    filter_lp = 0.0f;
static float    filter_hp = 0.0f;
static float    filter_w0 = 0.05f;
static float    filter_q  = 0.707f;

// 6581 $D418 Digi-Drum DAC & C64 AUDIO OUT AC-coupling state
static float    digi_dc_state = 1.0f;
static float    digi_boost = 1.35f;
static float    smoothed_vol = 1.0f;
static float    out_dc_l = 0.0f;
static float    out_dc_r = 0.0f;
static float    out_dc_coeff = 0.00196f;
static uint32_t d418_writes_this_frame = 0;
static uint32_t d418_writes_last_frame = 0;
static float    last_digi_sample = 0.0f;

// Sample clock state
static uint32_t sample_rate = 48000;
static double   cycles_per_sample = 985248.0 / 48000.0;
static double   sample_cycle_accum = 0.0;

static const uint16_t ADSR_RATE_PERIODS[16] = {
    9, 32, 63, 95, 149, 220, 267, 313,
    392, 977, 1954, 3126, 3907, 11720, 19532, 31251
};

static inline uint8_t get_exp_period(uint8_t env) {
    if (env >= 0x5D) return 1;
    if (env >= 0x36) return 2;
    if (env >= 0x1A) return 4;
    if (env >= 0x0E) return 8;
    if (env >= 0x06) return 16;
    return 30;
}

static void update_filter_coeffs(void) {
    // Map 11-bit filter_fc (0..2047) to cutoff Hz
    float norm = (float)filter_fc / 2047.0f;
    float cutoff_hz;
    if (sid_model_8580) {
        // 8580 linear-ish capacitor array curve (30 Hz .. 12000 Hz)
        cutoff_hz = 30.0f + 11970.0f * norm;
    } else {
        // 6581 S-curve FET resistance response (30 Hz .. 11500 Hz)
        float n2 = norm * norm;
        cutoff_hz = 35.0f + 11000.0f * (0.15f * norm + 0.85f * n2);
    }
    if (cutoff_hz > (float)sample_rate * 0.42f) {
        cutoff_hz = (float)sample_rate * 0.42f;
    }
    // 2 * sin(pi * fc / fs) approximated accurately
    float w = 2.0f * 3.14159265f * cutoff_hz / (float)sample_rate;
    // Chamberlin SVF stability limit
    if (w > 1.75f) w = 1.75f;
    filter_w0 = w;

    // Resonance 0..15 -> damping factor 1/Q
    float res_norm = (float)filter_res / 15.0f;
    if (sid_model_8580) {
        filter_q = 1.414f - 1.22f * res_norm;
    } else {
        filter_q = 1.35f - 1.18f * res_norm;
    }
    if (filter_q < 0.12f) filter_q = 0.12f;

    // C64 AUDIO OUT 10uF AC-coupling high-pass (~15 Hz cutoff)
    out_dc_coeff = 2.0f * 3.14159265f * 15.0f / (float)sample_rate;
    if (out_dc_coeff > 0.02f) out_dc_coeff = 0.02f;
}

static void sid_reset(void) {
    for (int i = 0; i < 32; i++) sid_regs[i] = 0;
    for (int v = 0; v < 3; v++) {
        voices[v].phase = 0;
        voices[v].lfsr = 0x7FFFF8;
        voices[v].freq = 0;
        voices[v].pw = 0;
        voices[v].control = 0;
        voices[v].attack = 0;
        voices[v].decay = 0;
        voices[v].sustain = 0;
        voices[v].release = 0;
        voices[v].env_level = 0;
        voices[v].env_state = ENV_IDLE;
        voices[v].rate_counter = 0;
        voices[v].exp_counter = 0;
        voices[v].hold_zero = 1;
        voices[v].last_out = 0.0f;
    }
    filter_fc = 0;
    filter_res = 0;
    filter_routing = 0;
    filter_mode = 0;
    master_vol = 15;
    filter_bp = 0.0f;
    filter_lp = 0.0f;
    filter_hp = 0.0f;
    digi_dc_state = 1.0f;
    smoothed_vol = 1.0f;
    out_dc_l = 0.0f;
    out_dc_r = 0.0f;
    d418_writes_this_frame = 0;
    d418_writes_last_frame = 0;
    last_digi_sample = 0.0f;
    update_filter_coeffs();
}

static void sid_write_reg(uint8_t reg, uint8_t val) {
    if (reg >= 32) return;
    sid_regs[reg] = val;

    if (reg < 21) {
        int v = (reg >= 14) ? 2 : (reg >= 7 ? 1 : 0);
        int r = reg - v * 7;
        SidVoice *vc = &voices[v];
        switch (r) {
            case 0:
            case 1:
                vc->freq = (uint16_t)sid_regs[v * 7 + 0] | ((uint16_t)sid_regs[v * 7 + 1] << 8);
                break;
            case 2:
            case 3:
                vc->pw = (uint16_t)sid_regs[v * 7 + 2] | (((uint16_t)sid_regs[v * 7 + 3] & 0x0F) << 8);
                break;
            case 4: {
                uint8_t prev = vc->control;
                vc->control = val;
                if (!(prev & 0x01) && (val & 0x01)) {
                    vc->env_state = ENV_ATTACK;
                    vc->hold_zero = 0;
                } else if ((prev & 0x01) && !(val & 0x01)) {
                    vc->env_state = ENV_RELEASE;
                }
                if (val & 0x08) {
                    vc->phase = 0;
                } else if (prev & 0x08) {
                    if (vc->lfsr == 0) vc->lfsr = 0x7FFFF8;
                }
                break;
            }
            case 5:
                vc->attack = (val >> 4) & 0x0F;
                vc->decay  = val & 0x0F;
                break;
            case 6:
                vc->sustain = (val >> 4) & 0x0F;
                vc->release = val & 0x0F;
                break;
        }
    } else {
        switch (reg) {
            case 0x15:
            case 0x16:
                filter_fc = (uint16_t)(sid_regs[0x15] & 0x07) | ((uint16_t)sid_regs[0x16] << 3);
                update_filter_coeffs();
                break;
            case 0x17:
                filter_res = (val >> 4) & 0x0F;
                filter_routing = val & 0x07;
                update_filter_coeffs();
                break;
            case 0x18: {
                uint8_t new_vol = val & 0x0F;
                if (new_vol != master_vol) {
                    d418_writes_this_frame++;
                }
                master_vol = new_vol;
                filter_mode = val & 0xF0;
                break;
            }
        }
    }
}

static void sid_clock_cycles(uint32_t cycles) {
    uint32_t prev_msb[3];
    for (int v = 0; v < 3; v++) {
        prev_msb[v] = voices[v].phase & 0x800000;
    }

    for (int v = 0; v < 3; v++) {
        SidVoice *vc = &voices[v];
        if (!(vc->control & 0x08)) {
            uint32_t old_phase = vc->phase;
            uint32_t new_phase = (old_phase + (uint32_t)vc->freq * cycles) & 0xFFFFFF;
            vc->phase = new_phase;

            // Clock 23-bit noise LFSR whenever bit 19 transitions 0 -> 1
            if (!(old_phase & 0x080000) && (new_phase & 0x080000)) {
                uint32_t lfsr = vc->lfsr;
                uint32_t bit0 = ((lfsr >> 22) ^ (lfsr >> 17)) & 1u;
                vc->lfsr = ((lfsr << 1) | bit0) & 0x7FFFFFu;
            }
        }

        // Advance ADSR rate counter
        uint16_t target_period = 9;
        if (vc->env_state == ENV_ATTACK) {
            target_period = ADSR_RATE_PERIODS[vc->attack];
        } else if (vc->env_state == ENV_DECAY) {
            target_period = ADSR_RATE_PERIODS[vc->decay];
        } else if (vc->env_state == ENV_RELEASE) {
            target_period = ADSR_RATE_PERIODS[vc->release];
        } else {
            target_period = 31251;
        }

        vc->rate_counter += (uint16_t)cycles;
        while (vc->rate_counter >= target_period) {
            vc->rate_counter -= target_period;
            if (vc->env_state == ENV_ATTACK) {
                vc->exp_counter = 0;
                if (!vc->hold_zero) {
                    if (vc->env_level == 0xFF) {
                        vc->env_state = ENV_DECAY;
                        target_period = ADSR_RATE_PERIODS[vc->decay];
                    } else {
                        vc->env_level++;
                        if (vc->env_level == 0xFF) {
                            vc->env_state = ENV_DECAY;
                            target_period = ADSR_RATE_PERIODS[vc->decay];
                        }
                    }
                }
            } else if (vc->env_state == ENV_DECAY || vc->env_state == ENV_RELEASE) {
                vc->exp_counter++;
                uint8_t exp_period = get_exp_period(vc->env_level);
                if (vc->exp_counter >= exp_period) {
                    vc->exp_counter = 0;
                    uint8_t sus_level = (uint8_t)((vc->sustain << 4) | vc->sustain);
                    if (vc->env_state == ENV_DECAY && vc->env_level == sus_level) {
                        // hold at sustain level
                    } else if (!vc->hold_zero) {
                        if (vc->env_level > 0) {
                            vc->env_level--;
                        }
                        if (vc->env_level == 0) {
                            vc->hold_zero = 1;
                        }
                    }
                }
            }
        }
    }

    // Check Hard Sync across the 3 voices (Voice v synced by source (v+2)%3)
    for (int v = 0; v < 3; v++) {
        if ((voices[v].control & 0x02) && !(voices[v].control & 0x08)) {
            int src = (v + 2) % 3;
            if (!prev_msb[src] && (voices[src].phase & 0x800000)) {
                voices[v].phase = 0;
            }
        }
    }
}

static inline uint16_t compute_voice_wave(int v) {
    SidVoice *vc = &voices[v];
    uint8_t wf = (vc->control >> 4) & 0x0F;
    if (wf == 0) return 0x800;

    uint32_t phase = vc->phase;
    uint16_t tri = 0xFFF;
    uint16_t saw = (uint16_t)((phase >> 12) & 0xFFF);
    uint16_t pls = ((vc->control & 0x08) || ((phase >> 12) & 0xFFF) >= vc->pw) ? 0xFFF : 0x000;

    if (wf & 0x01) {
        uint32_t msb = phase & 0x800000;
        if (vc->control & 0x04) { // Ring Modulation
            int src = (v + 2) % 3;
            msb ^= (voices[src].phase & 0x800000);
        }
        uint16_t t11 = (uint16_t)((phase >> 11) & 0xFFE);
        tri = msb ? (uint16_t)(0xFFF ^ t11) : t11;
    }

    if (wf == 0x01) return tri;
    if (wf == 0x02) return saw;
    if (wf == 0x04) return pls;
    if (wf == 0x08) {
        uint32_t l = vc->lfsr;
        uint16_t n8 = (uint16_t)(
            (((l >> 20) & 1) << 7) |
            (((l >> 18) & 1) << 6) |
            (((l >> 14) & 1) << 5) |
            (((l >> 11) & 1) << 4) |
            (((l >> 9)  & 1) << 3) |
            (((l >> 5)  & 1) << 2) |
            (((l >> 2)  & 1) << 1) |
            (((l >> 0)  & 1) << 0)
        );
        return (uint16_t)(n8 << 4);
    }

    // Combined waveforms (Saw+Tri, Pulse+Tri, Pulse+Saw, etc.)
    uint16_t comb = 0xFFF;
    if (wf & 0x01) comb &= tri;
    if (wf & 0x02) comb &= saw;
    if (wf & 0x04) comb &= pls;
    // Emulate 6581 adjacent bit pulldown
    if (!sid_model_8580 && (wf == 0x03 || wf == 0x06 || wf == 0x07)) {
        comb = (uint16_t)((comb & (comb << 1)) & 0xFFF);
    }
    return comb;
}

static void sid_generate_sample(float *out_l, float *out_r) {
    float dry_bus = 0.0f;
    float flt_in  = 0.0f;

    uint32_t sc_idx = scope_write_pos & 511u;

    for (int v = 0; v < 3; v++) {
        uint16_t wave12 = compute_voice_wave(v);
        float wave_centered = ((float)wave12 - 2048.0f) * (1.0f / 2048.0f);
        float env_norm = (float)voices[v].env_level * (1.0f / 255.0f);
        float v_out = wave_centered * env_norm;

        if (voice_mute_mask & (1u << v)) {
            v_out = 0.0f;
        }
        voices[v].last_out = v_out;
        voice_scope[v][sc_idx] = v_out;

        if (filter_routing & (1u << v)) {
            flt_in += v_out;
        } else {
            // Voice 2 (index 2) is disconnected if bit 7 of $D418 (3-off) is set
            if (v == 2 && (filter_mode & 0x80)) {
                continue;
            }
            dry_bus += v_out;
        }
    }

    // State-variable multimode filter (Chamberlin 2x oversampled for stability & warmth)
    for (int os = 0; os < 2; os++) {
        float w = filter_w0 * 0.5f;
        filter_hp = flt_in - filter_lp - filter_q * filter_bp;
        filter_bp += w * filter_hp;
        // Mild non-linear saturation on 6581 integrator
        if (!sid_model_8580) {
            if (filter_bp > 1.8f) filter_bp = 1.8f;
            else if (filter_bp < -1.8f) filter_bp = -1.8f;
            filter_bp -= 0.04f * (filter_bp * filter_bp * filter_bp);
        }
        filter_lp += w * filter_bp;
    }

    float flt_out = 0.0f;
    if (filter_mode & 0x10) flt_out += filter_lp;
    if (filter_mode & 0x20) flt_out += filter_bp;
    if (filter_mode & 0x40) flt_out += filter_hp;

    // 6581 $D418 Master Volume & Digi-Drum DAC
    float vol_norm = (float)master_vol * (1.0f / 15.0f);
    digi_dc_state += 0.0025f * (vol_norm - digi_dc_state);
    float digi_ac = (vol_norm - digi_dc_state) * digi_boost;
    if (voice_mute_mask & 0x08) {
        digi_ac = 0.0f;
    }
    last_digi_sample = digi_ac;

    // Smooth master volume slightly for the 3 analog voices when digi-drums are active
    // so rapid $D418 drum bit-banging doesn't chop sustained SID chords unnaturally
    bool digi_active = (d418_writes_this_frame > 3 || d418_writes_last_frame > 3);
    float target_v_gain = digi_active ? (0.55f + 0.45f * vol_norm) : vol_norm;
    smoothed_vol += 0.05f * (target_v_gain - smoothed_vol);

    float raw_mix = (dry_bus + flt_out) * 0.30f * smoothed_vol + digi_ac * 0.52f;

    // Subtle stereo spread option (voices 0,1,2 slightly panned around center)
    float stereo_diff = (voices[0].last_out - voices[2].last_out) * 0.06f * smoothed_vol;
    float raw_l = raw_mix - stereo_diff;
    float raw_r = raw_mix + stereo_diff;

    // C64 motherboard AUDIO OUT 10uF AC-coupling capacitor (~15 Hz high-pass)
    out_dc_l += out_dc_coeff * (raw_l - out_dc_l);
    out_dc_r += out_dc_coeff * (raw_r - out_dc_r);
    float ac_l = raw_l - out_dc_l;
    float ac_r = raw_r - out_dc_r;

    // Soft analog limiter
    if (ac_l > 0.98f) ac_l = 0.98f;
    else if (ac_l < -0.98f) ac_l = -0.98f;
    if (ac_r > 0.98f) ac_r = 0.98f;
    else if (ac_r < -0.98f) ac_r = -0.98f;

    voice_scope[3][sc_idx] = 0.5f * (ac_l + ac_r);
    scope_write_pos = (scope_write_pos + 1) & 511u;

    *out_l = ac_l;
    *out_r = ac_r;
}

// ============================================================================
// Memory Bus Read / Write
// ============================================================================

static inline uint8_t bus_read(uint16_t addr) {
    if (addr >= 0xD000 && addr < 0xE000) {
        if (addr == 0xD011) {
            return (ram[0xD011] & 0x7F) | ((vic_line & 0x100) ? 0x80 : 0x00);
        }
        if (addr == 0xD012) {
            return (uint8_t)(vic_line & 0xFF);
        }
        if (addr == 0xD019) {
            return vic_irq_status;
        }
        if (addr == 0xD01A) {
            return vic_irq_enable;
        }
        if (addr == 0xD020) {
            return border_color;
        }
        if (addr >= 0xD400 && addr <= 0xD41F) {
            uint8_t r = addr & 0x1F;
            if (r == 0x1B) return (uint8_t)(compute_voice_wave(2) >> 4);
            if (r == 0x1C) return voices[2].env_level;
            return sid_regs[r];
        }
        if (addr == 0xDC01) {
            return 0xFF;
        }
        if (addr == 0xDC0D) {
            return 0x00;
        }
    }
    return ram[addr];
}

static inline void bus_write(uint16_t addr, uint8_t val) {
    ram[addr] = val;
    if (addr >= 0xD000 && addr < 0xE000) {
        if (addr == 0xD011) {
            vic_irq_line = (vic_irq_line & 0x00FF) | ((uint16_t)(val & 0x80) << 1);
            return;
        }
        if (addr == 0xD012) {
            vic_irq_line = (vic_irq_line & 0x0100) | val;
            return;
        }
        if (addr == 0xD019) {
            vic_irq_status &= (uint8_t)~(val & 0x0F);
            if ((vic_irq_status & 0x0F) == 0) {
                vic_irq_status = 0;
            }
            return;
        }
        if (addr == 0xD01A) {
            vic_irq_enable = val & 0x0F;
            return;
        }
        if (addr == 0xD020) {
            border_color = val & 0x0F;
            if (vic_line < 312) {
                scanline_border[vic_line] = border_color;
            }
            return;
        }
        if (addr >= 0xD400 && addr <= 0xD418) {
            sid_write_reg((uint8_t)(addr - 0xD400), val);
            return;
        }
    }
}

// ============================================================================
// 6510 CPU Execution
// ============================================================================

static inline void set_zn(uint8_t v) {
    cpu_p = (cpu_p & ~(FLAG_Z | FLAG_N)) | (v == 0 ? FLAG_Z : 0) | (v & FLAG_N);
}

static inline void push8(uint8_t v) {
    ram[0x0100 | cpu_sp] = v;
    cpu_sp--;
}

static inline uint8_t pop8(void) {
    cpu_sp++;
    return ram[0x0100 | cpu_sp];
}

static inline void push16(uint16_t v) {
    push8((uint8_t)(v >> 8));
    push8((uint8_t)(v & 0xFF));
}

static inline uint16_t pop16(void) {
    uint16_t lo = pop8();
    uint16_t hi = pop8();
    return lo | (hi << 8);
}

static inline void do_adc(uint8_t val) {
    uint16_t c = (cpu_p & FLAG_C) ? 1 : 0;
    uint16_t sum = (uint16_t)cpu_a + (uint16_t)val + c;
    uint8_t res = (uint8_t)sum;
    cpu_p &= ~(FLAG_C | FLAG_V | FLAG_Z | FLAG_N);
    if (~(cpu_a ^ val) & (cpu_a ^ res) & 0x80) cpu_p |= FLAG_V;
    if (sum > 0xFF) cpu_p |= FLAG_C;
    cpu_a = res;
    set_zn(cpu_a);
}

static inline void do_sbc(uint8_t val) {
    do_adc((uint8_t)~val);
}

static inline void do_cmp(uint8_t reg, uint8_t val) {
    uint16_t diff = (uint16_t)reg - (uint16_t)val;
    cpu_p = (cpu_p & ~(FLAG_C | FLAG_Z | FLAG_N))
          | (reg >= val ? FLAG_C : 0)
          | ((diff & 0xFF) == 0 ? FLAG_Z : 0)
          | (diff & FLAG_N);
}

static uint32_t cpu_step(void) {
    if (cpu_jammed) return 2;

    // Check VIC-II Raster Interrupt
    if ((vic_irq_status & vic_irq_enable & 0x01) && !(cpu_p & FLAG_I)) {
        push16(cpu_pc);
        push8((cpu_p & ~FLAG_B) | FLAG_U);
        cpu_p |= FLAG_I;
        cpu_pc = (uint16_t)ram[0xFFFE] | ((uint16_t)ram[0xFFFF] << 8);
        return 7;
    }

    // Intercept KERNAL GETIN ($F13E) or Wizball KeyScan (custom_keyscan_addr)
    if (cpu_pc == 0xF13E || (custom_keyscan_addr != 0 && cpu_pc == custom_keyscan_addr)) {
        cpu_a = pending_key;
        pending_key = 0;
        set_zn(cpu_a);
        cpu_pc = pop16() + 1;
        return 6;
    }
    if (cpu_pc == 0xEA87) {
        cpu_pc = pop16() + 1;
        return 6;
    }

    uint8_t op = bus_read(cpu_pc++);

    // Addressing mode helpers
    #define IMM()   (cpu_pc++)
    #define ZP()    ((uint16_t)bus_read(cpu_pc++))
    #define ZPX()   ((uint16_t)((bus_read(cpu_pc++) + cpu_x) & 0xFF))
    #define ZPY()   ((uint16_t)((bus_read(cpu_pc++) + cpu_y) & 0xFF))
    #define ABS()   ({ uint16_t lo = bus_read(cpu_pc++); uint16_t hi = bus_read(cpu_pc++); lo | (hi << 8); })
    #define ABSX()  ({ uint16_t lo = bus_read(cpu_pc++); uint16_t hi = bus_read(cpu_pc++); (uint16_t)((lo | (hi << 8)) + cpu_x); })
    #define ABSY()  ({ uint16_t lo = bus_read(cpu_pc++); uint16_t hi = bus_read(cpu_pc++); (uint16_t)((lo | (hi << 8)) + cpu_y); })
    #define INDX()  ({ uint8_t zp = (uint8_t)(bus_read(cpu_pc++) + cpu_x); (uint16_t)ram[zp] | ((uint16_t)ram[(uint8_t)(zp + 1)] << 8); })
    #define INDY()  ({ uint8_t zp = bus_read(cpu_pc++); uint16_t base = (uint16_t)ram[zp] | ((uint16_t)ram[(uint8_t)(zp + 1)] << 8); (uint16_t)(base + cpu_y); })

    switch (op) {
        // LDA
        case 0xA9: cpu_a = bus_read(IMM());  set_zn(cpu_a); return 2;
        case 0xA5: cpu_a = bus_read(ZP());   set_zn(cpu_a); return 3;
        case 0xB5: cpu_a = bus_read(ZPX());  set_zn(cpu_a); return 4;
        case 0xAD: cpu_a = bus_read(ABS());  set_zn(cpu_a); return 4;
        case 0xBD: cpu_a = bus_read(ABSX()); set_zn(cpu_a); return 4;
        case 0xB9: cpu_a = bus_read(ABSY()); set_zn(cpu_a); return 4;
        case 0xA1: cpu_a = bus_read(INDX()); set_zn(cpu_a); return 6;
        case 0xB1: cpu_a = bus_read(INDY()); set_zn(cpu_a); return 5;

        // LDX
        case 0xA2: cpu_x = bus_read(IMM());  set_zn(cpu_x); return 2;
        case 0xA6: cpu_x = bus_read(ZP());   set_zn(cpu_x); return 3;
        case 0xB6: cpu_x = bus_read(ZPY());  set_zn(cpu_x); return 4;
        case 0xAE: cpu_x = bus_read(ABS());  set_zn(cpu_x); return 4;
        case 0xBE: cpu_x = bus_read(ABSY()); set_zn(cpu_x); return 4;

        // LDY
        case 0xA0: cpu_y = bus_read(IMM());  set_zn(cpu_y); return 2;
        case 0xA4: cpu_y = bus_read(ZP());   set_zn(cpu_y); return 3;
        case 0xB4: cpu_y = bus_read(ZPX());  set_zn(cpu_y); return 4;
        case 0xAC: cpu_y = bus_read(ABS());  set_zn(cpu_y); return 4;
        case 0xBC: cpu_y = bus_read(ABSX()); set_zn(cpu_y); return 4;

        // STA
        case 0x85: bus_write(ZP(),   cpu_a); return 3;
        case 0x95: bus_write(ZPX(),  cpu_a); return 4;
        case 0x8D: bus_write(ABS(),  cpu_a); return 4;
        case 0x9D: bus_write(ABSX(), cpu_a); return 5;
        case 0x99: bus_write(ABSY(), cpu_a); return 5;
        case 0x81: bus_write(INDX(), cpu_a); return 6;
        case 0x91: bus_write(INDY(), cpu_a); return 6;

        // STX
        case 0x86: bus_write(ZP(),   cpu_x); return 3;
        case 0x96: bus_write(ZPY(),  cpu_x); return 4;
        case 0x8E: bus_write(ABS(),  cpu_x); return 4;

        // STY
        case 0x84: bus_write(ZP(),   cpu_y); return 3;
        case 0x94: bus_write(ZPX(),  cpu_y); return 4;
        case 0x8C: bus_write(ABS(),  cpu_y); return 4;

        // Transfers
        case 0xAA: cpu_x = cpu_a; set_zn(cpu_x); return 2; // TAX
        case 0xA8: cpu_y = cpu_a; set_zn(cpu_y); return 2; // TAY
        case 0xBA: cpu_x = cpu_sp; set_zn(cpu_x); return 2; // TSX
        case 0x8A: cpu_a = cpu_x; set_zn(cpu_a); return 2; // TXA
        case 0x9A: cpu_sp = cpu_x; return 2;               // TXS
        case 0x98: cpu_a = cpu_y; set_zn(cpu_a); return 2; // TYA

        // Stack
        case 0x48: push8(cpu_a); return 3; // PHA
        case 0x08: push8(cpu_p | FLAG_B | FLAG_U); return 3; // PHP
        case 0x68: cpu_a = pop8(); set_zn(cpu_a); return 4; // PLA
        case 0x28: cpu_p = (pop8() & ~FLAG_B) | FLAG_U; return 4; // PLP

        // Logical AND
        case 0x29: cpu_a &= bus_read(IMM());  set_zn(cpu_a); return 2;
        case 0x25: cpu_a &= bus_read(ZP());   set_zn(cpu_a); return 3;
        case 0x35: cpu_a &= bus_read(ZPX());  set_zn(cpu_a); return 4;
        case 0x2D: cpu_a &= bus_read(ABS());  set_zn(cpu_a); return 4;
        case 0x3D: cpu_a &= bus_read(ABSX()); set_zn(cpu_a); return 4;
        case 0x39: cpu_a &= bus_read(ABSY()); set_zn(cpu_a); return 4;
        case 0x21: cpu_a &= bus_read(INDX()); set_zn(cpu_a); return 6;
        case 0x31: cpu_a &= bus_read(INDY()); set_zn(cpu_a); return 5;

        // Logical ORA
        case 0x09: cpu_a |= bus_read(IMM());  set_zn(cpu_a); return 2;
        case 0x05: cpu_a |= bus_read(ZP());   set_zn(cpu_a); return 3;
        case 0x15: cpu_a |= bus_read(ZPX());  set_zn(cpu_a); return 4;
        case 0x0D: cpu_a |= bus_read(ABS());  set_zn(cpu_a); return 4;
        case 0x1D: cpu_a |= bus_read(ABSX()); set_zn(cpu_a); return 4;
        case 0x19: cpu_a |= bus_read(ABSY()); set_zn(cpu_a); return 4;
        case 0x01: cpu_a |= bus_read(INDX()); set_zn(cpu_a); return 6;
        case 0x11: cpu_a |= bus_read(INDY()); set_zn(cpu_a); return 5;

        // Logical EOR
        case 0x49: cpu_a ^= bus_read(IMM());  set_zn(cpu_a); return 2;
        case 0x45: cpu_a ^= bus_read(ZP());   set_zn(cpu_a); return 3;
        case 0x55: cpu_a ^= bus_read(ZPX());  set_zn(cpu_a); return 4;
        case 0x4D: cpu_a ^= bus_read(ABS());  set_zn(cpu_a); return 4;
        case 0x5D: cpu_a ^= bus_read(ABSX()); set_zn(cpu_a); return 4;
        case 0x59: cpu_a ^= bus_read(ABSY()); set_zn(cpu_a); return 4;
        case 0x41: cpu_a ^= bus_read(INDX()); set_zn(cpu_a); return 6;
        case 0x51: cpu_a ^= bus_read(INDY()); set_zn(cpu_a); return 5;

        // BIT
        case 0x24: {
            uint8_t m = bus_read(ZP());
            cpu_p = (cpu_p & ~(FLAG_Z | FLAG_V | FLAG_N)) | ((cpu_a & m) == 0 ? FLAG_Z : 0) | (m & (FLAG_V | FLAG_N));
            return 3;
        }
        case 0x2C: {
            uint8_t m = bus_read(ABS());
            cpu_p = (cpu_p & ~(FLAG_Z | FLAG_V | FLAG_N)) | ((cpu_a & m) == 0 ? FLAG_Z : 0) | (m & (FLAG_V | FLAG_N));
            return 4;
        }

        // ADC
        case 0x69: do_adc(bus_read(IMM()));  return 2;
        case 0x65: do_adc(bus_read(ZP()));   return 3;
        case 0x75: do_adc(bus_read(ZPX()));  return 4;
        case 0x6D: do_adc(bus_read(ABS()));  return 4;
        case 0x7D: do_adc(bus_read(ABSX())); return 4;
        case 0x79: do_adc(bus_read(ABSY())); return 4;
        case 0x61: do_adc(bus_read(INDX())); return 6;
        case 0x71: do_adc(bus_read(INDY())); return 5;

        // SBC
        case 0xE9: do_sbc(bus_read(IMM()));  return 2;
        case 0xE5: do_sbc(bus_read(ZP()));   return 3;
        case 0xF5: do_sbc(bus_read(ZPX()));  return 4;
        case 0xED: do_sbc(bus_read(ABS()));  return 4;
        case 0xFD: do_sbc(bus_read(ABSX())); return 4;
        case 0xF9: do_sbc(bus_read(ABSY())); return 4;
        case 0xE1: do_sbc(bus_read(INDX())); return 6;
        case 0xF1: do_sbc(bus_read(INDY())); return 5;

        // CMP
        case 0xC9: do_cmp(cpu_a, bus_read(IMM()));  return 2;
        case 0xC5: do_cmp(cpu_a, bus_read(ZP()));   return 3;
        case 0xD5: do_cmp(cpu_a, bus_read(ZPX()));  return 4;
        case 0xCD: do_cmp(cpu_a, bus_read(ABS()));  return 4;
        case 0xDD: do_cmp(cpu_a, bus_read(ABSX())); return 4;
        case 0xD9: do_cmp(cpu_a, bus_read(ABSY())); return 4;
        case 0xC1: do_cmp(cpu_a, bus_read(INDX())); return 6;
        case 0xD1: do_cmp(cpu_a, bus_read(INDY())); return 5;

        // CPX
        case 0xE0: do_cmp(cpu_x, bus_read(IMM())); return 2;
        case 0xE4: do_cmp(cpu_x, bus_read(ZP()));  return 3;
        case 0xEC: do_cmp(cpu_x, bus_read(ABS())); return 4;

        // CPY
        case 0xC0: do_cmp(cpu_y, bus_read(IMM())); return 2;
        case 0xC4: do_cmp(cpu_y, bus_read(ZP()));  return 3;
        case 0xCC: do_cmp(cpu_y, bus_read(ABS())); return 4;

        // INC / DEC
        case 0xE6: { uint16_t a = ZP();   uint8_t v = (uint8_t)(bus_read(a) + 1); bus_write(a, v); set_zn(v); return 5; }
        case 0xF6: { uint16_t a = ZPX();  uint8_t v = (uint8_t)(bus_read(a) + 1); bus_write(a, v); set_zn(v); return 6; }
        case 0xEE: { uint16_t a = ABS();  uint8_t v = (uint8_t)(bus_read(a) + 1); bus_write(a, v); set_zn(v); return 6; }
        case 0xFE: { uint16_t a = ABSX(); uint8_t v = (uint8_t)(bus_read(a) + 1); bus_write(a, v); set_zn(v); return 7; }

        case 0xC6: { uint16_t a = ZP();   uint8_t v = (uint8_t)(bus_read(a) - 1); bus_write(a, v); set_zn(v); return 5; }
        case 0xD6: { uint16_t a = ZPX();  uint8_t v = (uint8_t)(bus_read(a) - 1); bus_write(a, v); set_zn(v); return 6; }
        case 0xCE: { uint16_t a = ABS();  uint8_t v = (uint8_t)(bus_read(a) - 1); bus_write(a, v); set_zn(v); return 6; }
        case 0xDE: { uint16_t a = ABSX(); uint8_t v = (uint8_t)(bus_read(a) - 1); bus_write(a, v); set_zn(v); return 7; }

        case 0xE8: cpu_x++; set_zn(cpu_x); return 2; // INX
        case 0xC8: cpu_y++; set_zn(cpu_y); return 2; // INY
        case 0xCA: cpu_x--; set_zn(cpu_x); return 2; // DEX
        case 0x88: cpu_y--; set_zn(cpu_y); return 2; // DEY

        // Shifts & Rotates: ASL
        case 0x0A: cpu_p = (cpu_p & ~FLAG_C) | (cpu_a >> 7); cpu_a <<= 1; set_zn(cpu_a); return 2;
        case 0x06: { uint16_t a = ZP();   uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v <<= 1; bus_write(a, v); set_zn(v); return 5; }
        case 0x16: { uint16_t a = ZPX();  uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v <<= 1; bus_write(a, v); set_zn(v); return 6; }
        case 0x0E: { uint16_t a = ABS();  uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v <<= 1; bus_write(a, v); set_zn(v); return 6; }
        case 0x1E: { uint16_t a = ABSX(); uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v <<= 1; bus_write(a, v); set_zn(v); return 7; }

        // LSR
        case 0x4A: cpu_p = (cpu_p & ~FLAG_C) | (cpu_a & 1); cpu_a >>= 1; set_zn(cpu_a); return 2;
        case 0x46: { uint16_t a = ZP();   uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v >>= 1; bus_write(a, v); set_zn(v); return 5; }
        case 0x56: { uint16_t a = ZPX();  uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v >>= 1; bus_write(a, v); set_zn(v); return 6; }
        case 0x4E: { uint16_t a = ABS();  uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v >>= 1; bus_write(a, v); set_zn(v); return 6; }
        case 0x5E: { uint16_t a = ABSX(); uint8_t v = bus_read(a); cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v >>= 1; bus_write(a, v); set_zn(v); return 7; }

        // ROL
        case 0x2A: { uint8_t c = cpu_p & FLAG_C; cpu_p = (cpu_p & ~FLAG_C) | (cpu_a >> 7); cpu_a = (uint8_t)((cpu_a << 1) | c); set_zn(cpu_a); return 2; }
        case 0x26: { uint16_t a = ZP();   uint8_t v = bus_read(a); uint8_t c = cpu_p & FLAG_C; cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v = (uint8_t)((v << 1) | c); bus_write(a, v); set_zn(v); return 5; }
        case 0x36: { uint16_t a = ZPX();  uint8_t v = bus_read(a); uint8_t c = cpu_p & FLAG_C; cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v = (uint8_t)((v << 1) | c); bus_write(a, v); set_zn(v); return 6; }
        case 0x2E: { uint16_t a = ABS();  uint8_t v = bus_read(a); uint8_t c = cpu_p & FLAG_C; cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v = (uint8_t)((v << 1) | c); bus_write(a, v); set_zn(v); return 6; }
        case 0x3E: { uint16_t a = ABSX(); uint8_t v = bus_read(a); uint8_t c = cpu_p & FLAG_C; cpu_p = (cpu_p & ~FLAG_C) | (v >> 7); v = (uint8_t)((v << 1) | c); bus_write(a, v); set_zn(v); return 7; }

        // ROR
        case 0x6A: { uint8_t c = (cpu_p & FLAG_C) << 7; cpu_p = (cpu_p & ~FLAG_C) | (cpu_a & 1); cpu_a = (uint8_t)((cpu_a >> 1) | c); set_zn(cpu_a); return 2; }
        case 0x66: { uint16_t a = ZP();   uint8_t v = bus_read(a); uint8_t c = (cpu_p & FLAG_C) << 7; cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v = (uint8_t)((v >> 1) | c); bus_write(a, v); set_zn(v); return 5; }
        case 0x76: { uint16_t a = ZPX();  uint8_t v = bus_read(a); uint8_t c = (cpu_p & FLAG_C) << 7; cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v = (uint8_t)((v >> 1) | c); bus_write(a, v); set_zn(v); return 6; }
        case 0x6E: { uint16_t a = ABS();  uint8_t v = bus_read(a); uint8_t c = (cpu_p & FLAG_C) << 7; cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v = (uint8_t)((v >> 1) | c); bus_write(a, v); set_zn(v); return 6; }
        case 0x7E: { uint16_t a = ABSX(); uint8_t v = bus_read(a); uint8_t c = (cpu_p & FLAG_C) << 7; cpu_p = (cpu_p & ~FLAG_C) | (v & 1); v = (uint8_t)((v >> 1) | c); bus_write(a, v); set_zn(v); return 7; }

        // Branches
        case 0x90: { int8_t off = (int8_t)bus_read(cpu_pc++); if (!(cpu_p & FLAG_C)) { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BCC
        case 0xB0: { int8_t off = (int8_t)bus_read(cpu_pc++); if (cpu_p & FLAG_C)    { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BCS
        case 0xF0: { int8_t off = (int8_t)bus_read(cpu_pc++); if (cpu_p & FLAG_Z)    { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BEQ
        case 0xD0: { int8_t off = (int8_t)bus_read(cpu_pc++); if (!(cpu_p & FLAG_Z)) { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BNE
        case 0x30: { int8_t off = (int8_t)bus_read(cpu_pc++); if (cpu_p & FLAG_N)    { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BMI
        case 0x10: { int8_t off = (int8_t)bus_read(cpu_pc++); if (!(cpu_p & FLAG_N)) { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BPL
        case 0x50: { int8_t off = (int8_t)bus_read(cpu_pc++); if (!(cpu_p & FLAG_V)) { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BVC
        case 0x70: { int8_t off = (int8_t)bus_read(cpu_pc++); if (cpu_p & FLAG_V)    { cpu_pc = (uint16_t)(cpu_pc + off); return 3; } return 2; } // BVS

        // Jumps & Subroutines
        case 0x4C: cpu_pc = ABS(); return 3; // JMP abs
        case 0x6C: { // JMP (ind)
            uint16_t ptr = ABS();
            uint16_t lo = bus_read(ptr);
            uint16_t hi = bus_read((ptr & 0xFF00) | ((ptr + 1) & 0x00FF));
            cpu_pc = lo | (hi << 8);
            return 5;
        }
        case 0x20: { // JSR
            uint16_t target = ABS();
            push16((uint16_t)(cpu_pc - 1));
            cpu_pc = target;
            return 6;
        }
        case 0x60: cpu_pc = (uint16_t)(pop16() + 1); return 6; // RTS
        case 0x40: { // RTI
            cpu_p = (pop8() & ~FLAG_B) | FLAG_U;
            cpu_pc = pop16();
            return 6;
        }

        // Flags
        case 0x18: cpu_p &= ~FLAG_C; return 2; // CLC
        case 0x38: cpu_p |= FLAG_C;  return 2; // SEC
        case 0xD8: cpu_p &= ~FLAG_D; return 2; // CLD
        case 0xF8: cpu_p |= FLAG_D;  return 2; // SED
        case 0x58: cpu_p &= ~FLAG_I; return 2; // CLI
        case 0x78: cpu_p |= FLAG_I;  return 2; // SEI
        case 0xB8: cpu_p &= ~FLAG_V; return 2; // CLV

        case 0xEA: return 2; // NOP

        case 0x00: // BRK
            cpu_jammed = 1;
            return 7;

        default:
            return 2;
    }
}

// ============================================================================
// Public WASM API
// ============================================================================

WASM_EXPORT void wasm_init(uint32_t sr) {
    if (sr < 8000 || sr > 192000) sr = 48000;
    sample_rate = sr;
    uint32_t clock = is_ntsc ? NTSC_CLOCK_HZ : PAL_CLOCK_HZ;
    cycles_per_sample = (double)clock / (double)sample_rate;
    sample_cycle_accum = 0.0;

    for (int i = 0; i < 65536; i++) ram[i] = 0;
    for (int i = 0; i < 312; i++) scanline_border[i] = 0;
    for (int v = 0; v < 4; v++) {
        for (int i = 0; i < 512; i++) voice_scope[v][i] = 0.0f;
    }

    // Install default KERNAL stubs at $EA87 (SCNKEY) and $F13E (GETIN) and IRQ/NMI at $FFFA-$FFFF
    ram[0xEA87] = 0x60; // RTS
    ram[0xF13E] = 0x60; // RTS
    ram[0x0107] = 0x40; // RTI at NMI ($0107)

    cpu_pc = 0x1000;
    cpu_a = 0;
    cpu_x = 0;
    cpu_y = 0;
    cpu_sp = 0xFD;
    cpu_p = FLAG_U | FLAG_I;
    total_cycles = 0;
    frame_count = 0;
    cpu_jammed = 0;

    vic_line = 0;
    vic_line_cycle = 0;
    vic_irq_line = 0x1FF;
    vic_irq_status = 0;
    vic_irq_enable = 0;
    border_color = 0;
    pending_key = 0;
    custom_keyscan_addr = 0;
    voice_mute_mask = 0;

    sid_reset();
}

WASM_EXPORT uint8_t* wasm_get_ram_ptr(void) { return ram; }
WASM_EXPORT uint8_t* wasm_get_sid_regs_ptr(void) { return sid_regs; }
WASM_EXPORT uint8_t* wasm_get_border_ptr(void) { return scanline_border; }
WASM_EXPORT float*   wasm_get_audio_l_ptr(void) { return audio_out_l; }
WASM_EXPORT float*   wasm_get_audio_r_ptr(void) { return audio_out_r; }
WASM_EXPORT float*   wasm_get_scope_ptr(int ch) {
    if (ch < 0 || ch > 3) ch = 3;
    return voice_scope[ch];
}
WASM_EXPORT uint32_t wasm_get_scope_write_pos(void) { return scope_write_pos; }

WASM_EXPORT void wasm_set_cpu_state(uint16_t pc, uint8_t a, uint8_t x, uint8_t y, uint8_t sp, uint8_t p) {
    cpu_pc = pc;
    cpu_a = a;
    cpu_x = x;
    cpu_y = y;
    cpu_sp = sp;
    cpu_p = p | FLAG_U;
    cpu_jammed = 0;
}

WASM_EXPORT void wasm_set_custom_keyscan(uint16_t addr) {
    custom_keyscan_addr = addr;
}

WASM_EXPORT void wasm_inject_key(uint8_t petscii_key) {
    pending_key = petscii_key;
}

WASM_EXPORT void wasm_set_sid_model(uint8_t is_8580) {
    sid_model_8580 = is_8580 ? 1 : 0;
    update_filter_coeffs();
}

WASM_EXPORT void wasm_set_sample_rate(uint32_t sr) {
    if (sr < 8000 || sr > 192000) sr = 48000;
    sample_rate = sr;
    uint32_t clock = is_ntsc ? NTSC_CLOCK_HZ : PAL_CLOCK_HZ;
    cycles_per_sample = (double)clock / (double)sample_rate;
    update_filter_coeffs();
}

WASM_EXPORT void wasm_set_video_standard(uint8_t ntsc) {
    is_ntsc = ntsc ? 1 : 0;
    uint32_t clock = is_ntsc ? NTSC_CLOCK_HZ : PAL_CLOCK_HZ;
    cycles_per_sample = (double)clock / (double)sample_rate;
}

WASM_EXPORT void wasm_set_voice_mute_mask(uint8_t mask) {
    voice_mute_mask = mask;
}

WASM_EXPORT void wasm_set_digi_boost(float boost) {
    if (boost < 0.0f) boost = 0.0f;
    if (boost > 3.0f) boost = 3.0f;
    digi_boost = boost;
}

WASM_EXPORT void wasm_write_bus(uint16_t addr, uint8_t val) {
    bus_write(addr, val);
}

// Fast-forward `num_frames` video frames (stepping CPU, VIC-II, and SID state without float filter synthesis)
WASM_EXPORT void wasm_fast_forward_frames(uint32_t num_frames) {
    uint16_t total_lines = is_ntsc ? NTSC_LINES : PAL_LINES;
    uint16_t cyc_per_line = is_ntsc ? NTSC_CYCLES_LINE : PAL_CYCLES_LINE;
    uint32_t target_frame = frame_count + num_frames;

    while (frame_count < target_frame && !cpu_jammed) {
        uint32_t cyc = cpu_step();
        total_cycles += cyc;

        vic_line_cycle += (uint16_t)cyc;
        while (vic_line_cycle >= cyc_per_line) {
            vic_line_cycle -= cyc_per_line;
            vic_line++;
            if (vic_line >= total_lines) {
                vic_line = 0;
                frame_count++;
                d418_writes_last_frame = d418_writes_this_frame;
                d418_writes_this_frame = 0;
            }
            if (vic_line < 312) {
                scanline_border[vic_line] = border_color;
            }
            if (vic_line == vic_irq_line) {
                vic_irq_status |= 0x81;
            }
        }
        sid_clock_cycles(cyc);
    }
}

// Run a subroutine synchronously (e.g., InitScreen, INITSOUND, TUNE, EFFECT) up to max_cycles
WASM_EXPORT uint32_t wasm_jsr(uint16_t addr, uint8_t a, uint8_t x, uint8_t y, uint32_t max_cycles) {
    uint8_t saved_sp = cpu_sp;
    // Place sentinel return address $FFFC-1 on stack
    ram[0xFFFC] = 0x00; // BRK sentinel
    push16(0xFFFB);
    cpu_pc = addr;
    cpu_a = a;
    cpu_x = x;
    cpu_y = y;
    cpu_jammed = 0;

    uint32_t elapsed = 0;
    uint16_t total_lines = is_ntsc ? NTSC_LINES : PAL_LINES;
    uint16_t cyc_per_line = is_ntsc ? NTSC_CYCLES_LINE : PAL_CYCLES_LINE;

    while (elapsed < max_cycles && cpu_pc != 0xFFFC && !cpu_jammed) {
        uint32_t cyc = cpu_step();
        elapsed += cyc;
        vic_line_cycle += cyc;
        while (vic_line_cycle >= cyc_per_line) {
            vic_line_cycle -= cyc_per_line;
            vic_line++;
            if (vic_line >= total_lines) vic_line = 0;
        }
    }
    cpu_sp = saved_sp;
    cpu_jammed = 0;
    return elapsed;
}

// Render `num_samples` stereo audio frames while stepping the C64 CPU, VIC-II, and SID
WASM_EXPORT void wasm_render_audio(uint32_t num_samples) {
    if (num_samples > MAX_AUDIO_FRAMES) num_samples = MAX_AUDIO_FRAMES;

    uint16_t total_lines = is_ntsc ? NTSC_LINES : PAL_LINES;
    uint16_t cyc_per_line = is_ntsc ? NTSC_CYCLES_LINE : PAL_CYCLES_LINE;

    uint32_t generated = 0;
    while (generated < num_samples) {
        uint32_t cyc = cpu_step();
        total_cycles += cyc;

        // Advance VIC-II raster line
        vic_line_cycle += (uint16_t)cyc;
        while (vic_line_cycle >= cyc_per_line) {
            vic_line_cycle -= cyc_per_line;
            vic_line++;
            if (vic_line >= total_lines) {
                vic_line = 0;
                frame_count++;
                d418_writes_last_frame = d418_writes_this_frame;
                d418_writes_this_frame = 0;
            }
            if (vic_line < 312) {
                scanline_border[vic_line] = border_color;
            }
            if (vic_line == vic_irq_line) {
                vic_irq_status |= 0x81;
            }
        }

        // Advance SID by `cyc` CPU cycles
        sid_clock_cycles(cyc);

        sample_cycle_accum += (double)cyc;
        while (sample_cycle_accum >= cycles_per_sample && generated < num_samples) {
            sample_cycle_accum -= cycles_per_sample;
            float l = 0.0f, r = 0.0f;
            sid_generate_sample(&l, &r);
            audio_out_l[generated] = l;
            audio_out_r[generated] = r;
            generated++;
        }
    }
}

WASM_EXPORT uint16_t wasm_get_cpu_pc(void) { return cpu_pc; }
WASM_EXPORT uint32_t wasm_get_frame_count(void) { return frame_count; }
WASM_EXPORT uint32_t wasm_get_d418_activity(void) { return d418_writes_last_frame; }
WASM_EXPORT uint8_t  wasm_get_voice_env(int v) {
    if (v < 0 || v > 2) return 0;
    return voices[v].env_level;
}
WASM_EXPORT uint16_t wasm_get_voice_freq(int v) {
    if (v < 0 || v > 2) return 0;
    return voices[v].freq;
}
WASM_EXPORT uint16_t wasm_get_voice_pw(int v) {
    if (v < 0 || v > 2) return 0;
    return voices[v].pw;
}
WASM_EXPORT uint8_t  wasm_get_voice_control(int v) {
    if (v < 0 || v > 2) return 0;
    return voices[v].control;
}
WASM_EXPORT uint16_t wasm_get_filter_fc(void) { return filter_fc; }
WASM_EXPORT uint8_t  wasm_get_filter_res(void) { return filter_res; }
WASM_EXPORT uint8_t  wasm_get_filter_routing(void) { return filter_routing; }
WASM_EXPORT uint8_t  wasm_get_filter_mode(void) { return filter_mode; }
WASM_EXPORT uint8_t  wasm_get_master_vol(void) { return master_vol; }
