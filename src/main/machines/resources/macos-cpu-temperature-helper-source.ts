/**
 * C source of the helper a Mac compiles for itself: macOS has no command that reads the processor
 * temperature without sudo. It prints `@mactemp\tsmc\t<key>\t<celsius>` for each SMC reading, or,
 * where the SMC has none, `@mactemp\thid\t<sensor name>\t<celsius>` for the HID core sensors.
 */
export const MACOS_CPU_TEMPERATURE_HELPER_SOURCE = String.raw`#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/sysctl.h>

typedef struct {
  char major, minor, build, reserved;
  uint16_t release;
} SMCVersion;
typedef struct {
  uint16_t version, length;
  uint32_t cpuPLimit, gpuPLimit, memPLimit;
} SMCPLimitData;
typedef struct {
  uint32_t dataSize, dataType;
  char dataAttributes;
} SMCKeyInfo;
typedef struct {
  uint32_t key;
  SMCVersion vers;
  SMCPLimitData pLimitData;
  SMCKeyInfo keyInfo;
  char result, status, data8;
  uint32_t data32;
  unsigned char bytes[32];
} SMCKeyData_t;
/* The kernel refuses a struct laid out any other way. */
typedef char smc_layout_check[sizeof(SMCKeyData_t) == 80 && offsetof(SMCKeyData_t, keyInfo) == 28 &&
  offsetof(SMCKeyData_t, data8) == 42 && offsetof(SMCKeyData_t, data32) == 44 &&
  offsetof(SMCKeyData_t, bytes) == 48 ? 1 : -1];

#define FCC(a, b, c, d) \
  ((uint32_t)(unsigned char)(a) << 24 | (uint32_t)(unsigned char)(b) << 16 | \
   (uint32_t)(unsigned char)(c) << 8 | (uint32_t)(unsigned char)(d))
#define SMC_READ_BYTES 5
#define SMC_READ_INDEX 8
#define SMC_READ_KEYINFO 9

/* Performance and efficiency cores of the M1, M2, M3 and M4 families. */
static const char APPLE_KEYS[] =
  "Tp09Tp0TTp01Tp05Tp0DTp0HTp0LTp0PTp0XTp0b"
  "Tp1hTp1tTp1pTp1lTp0fTp0j"
  "Te05Te0LTe0PTe0STf04Tf09Tf0ATf0BTf0DTf0ETf44Tf49Tf4ATf4BTf4DTf4E"
  "Te09Te0HTp0VTp0YTp0e";
/* Package, proximity, die, then each core. */
static const char INTEL_KEYS[] =
  "TCXCTC0PTC0DTC0ETC0F"
  "TC0CTC1CTC2CTC3CTC4CTC5CTC6CTC7CTC8CTC9C"
  "TC0cTC1cTC2cTC3cTC4cTC5cTC6cTC7cTC8cTC9c";
typedef char key_list_check[(sizeof(APPLE_KEYS) - 1) % 4 == 0 &&
  (sizeof(INTEL_KEYS) - 1) % 4 == 0 ? 1 : -1];

static int plausible(double celsius) {
  return celsius > 0 && celsius < 150;
}

static int smc_call(io_connect_t conn, const SMCKeyData_t *in, SMCKeyData_t *out) {
  size_t size = sizeof(*out);
  memset(out, 0, sizeof(*out));
  return IOConnectCallStructMethod(conn, 2, in, sizeof(*in), out, &size) == KERN_SUCCESS &&
    out->result == 0;
}

static int smc_read(io_connect_t conn, uint32_t key, SMCKeyData_t *out) {
  SMCKeyData_t in, info;
  memset(&in, 0, sizeof(in));
  in.key = key;
  in.data8 = SMC_READ_KEYINFO;
  if (!smc_call(conn, &in, &info) || info.keyInfo.dataSize == 0 || info.keyInfo.dataSize > 32) {
    return 0;
  }
  in.keyInfo.dataSize = info.keyInfo.dataSize;
  in.data8 = SMC_READ_BYTES;
  if (!smc_call(conn, &in, out)) {
    return 0;
  }
  out->keyInfo = info.keyInfo;
  return 1;
}

static uint32_t smc_key_count(io_connect_t conn) {
  SMCKeyData_t out;
  if (!smc_read(conn, FCC('#', 'K', 'E', 'Y'), &out) || out.keyInfo.dataSize != 4) {
    return 0;
  }
  return FCC(out.bytes[0], out.bytes[1], out.bytes[2], out.bytes[3]);
}

static int smc_report(io_connect_t conn, uint32_t key, int float_only) {
  SMCKeyData_t out;
  double celsius = 0;
  float value;
  int shift;
  for (shift = 0; shift < 32; shift += 8) {
    unsigned char c = (unsigned char)(key >> shift);
    if (c < 0x21 || c > 0x7e) {
      return 0;
    }
  }
  if (!smc_read(conn, key, &out)) {
    return 0;
  }
  if (out.keyInfo.dataType == FCC('f', 'l', 't', ' ') && out.keyInfo.dataSize == 4) {
    memcpy(&value, out.bytes, sizeof(value));
    celsius = value;
  } else if (!float_only && out.keyInfo.dataType == FCC('s', 'p', '7', '8') &&
             out.keyInfo.dataSize == 2) {
    celsius = (int16_t)(uint16_t)(out.bytes[0] << 8 | out.bytes[1]) / 256.0;
  }
  if (!plausible(celsius)) {
    return 0;
  }
  printf("@mactemp\tsmc\t%c%c%c%c\t%.1f\n", (int)(key >> 24), (int)(key >> 16 & 0xff),
         (int)(key >> 8 & 0xff), (int)(key & 0xff), celsius);
  return 1;
}

static int smc_report_keys(io_connect_t conn, const char *keys) {
  int found = 0;
  for (; keys[0]; keys += 4) {
    found += smc_report(conn, FCC(keys[0], keys[1], keys[2], keys[3]), 0);
  }
  return found;
}

/* A chip newer than the lists above still names its core sensors Tp.. and Te... */
static int smc_report_unlisted(io_connect_t conn) {
  uint32_t count = smc_key_count(conn), index;
  int found = 0;
  if (count > 20000) {
    count = 20000;
  }
  for (index = 0; index < count; index++) {
    SMCKeyData_t in, out;
    memset(&in, 0, sizeof(in));
    in.data8 = SMC_READ_INDEX;
    in.data32 = index;
    if (smc_call(conn, &in, &out) &&
        (out.key >> 16 == (FCC(0, 0, 'T', 'p')) || out.key >> 16 == (FCC(0, 0, 'T', 'e')))) {
      found += smc_report(conn, out.key, 1);
    }
  }
  return found;
}

static io_connect_t smc_open(void) {
  io_iterator_t services = 0;
  io_object_t service;
  io_connect_t conn = 0;
  CFMutableDictionaryRef matching = IOServiceMatching("AppleSMC");
  if (!matching || IOServiceGetMatchingServices(0, matching, &services) != KERN_SUCCESS) {
    return 0;
  }
  while (!conn && (service = IOIteratorNext(services)) != 0) {
    if (IOServiceOpen(service, mach_task_self(), 0, &conn) != KERN_SUCCESS) {
      conn = 0;
    } else if (smc_key_count(conn) == 0) {
      IOServiceClose(conn);
      conn = 0;
    }
    IOObjectRelease(service);
  }
  IOObjectRelease(services);
  return conn;
}

typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
typedef struct __IOHIDEvent *IOHIDEventRef;
IOHIDEventSystemClientRef IOHIDEventSystemClientCreate(CFAllocatorRef allocator);
void IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef client, CFDictionaryRef match);
CFArrayRef IOHIDEventSystemClientCopyServices(IOHIDEventSystemClientRef client);
CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef service, CFStringRef key);
/* Full-width arguments suit both prototypes in circulation for this private call. */
IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef service, int64_t type,
                                          int64_t matching, int64_t options);
double IOHIDEventGetFloatValue(IOHIDEventRef event, int32_t field);
#define HID_TEMPERATURE_EVENT 15

static void hid_report_service(IOHIDServiceClientRef service) {
  char name[128];
  char *c;
  IOHIDEventRef event;
  double celsius;
  CFTypeRef product = IOHIDServiceClientCopyProperty(service, CFSTR("Product"));
  if (!product) {
    return;
  }
  /* Only the core sensors: the battery, storage and GPU ones are not the processor. */
  if (CFGetTypeID(product) == CFStringGetTypeID() &&
      CFStringGetCString((CFStringRef)product, name, sizeof(name), kCFStringEncodingUTF8) &&
      (strncmp(name, "pACC MTR Temp Sensor", 20) == 0 ||
       strncmp(name, "eACC MTR Temp Sensor", 20) == 0) &&
      (event = IOHIDServiceClientCopyEvent(service, HID_TEMPERATURE_EVENT, 0, 0)) != NULL) {
    celsius = IOHIDEventGetFloatValue(event, HID_TEMPERATURE_EVENT << 16);
    CFRelease(event);
    for (c = name; *c; c++) {
      if ((unsigned char)*c < 0x20) {
        *c = ' ';
      }
    }
    if (plausible(celsius)) {
      printf("@mactemp\thid\t%s\t%.1f\n", name, celsius);
    }
  }
  CFRelease(product);
}

static void hid_report(void) {
  int32_t page = 0xff00, usage = 5;
  CFStringRef keys[2];
  CFNumberRef values[2];
  CFDictionaryRef match = NULL;
  CFArrayRef services = NULL;
  IOHIDEventSystemClientRef client = NULL;
  CFIndex index, count;
  keys[0] = CFSTR("PrimaryUsagePage");
  keys[1] = CFSTR("PrimaryUsage");
  values[0] = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &page);
  values[1] = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &usage);
  if (values[0] && values[1]) {
    match = CFDictionaryCreate(kCFAllocatorDefault, (const void **)keys, (const void **)values, 2,
                               &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  }
  if (match) {
    client = IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  }
  if (client) {
    IOHIDEventSystemClientSetMatching(client, match);
    services = IOHIDEventSystemClientCopyServices(client);
  }
  count = services ? CFArrayGetCount(services) : 0;
  for (index = 0; index < count; index++) {
    IOHIDServiceClientRef service = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(services, index);
    if (service) {
      hid_report_service(service);
    }
  }
  if (services) CFRelease(services);
  if (client) CFRelease(client);
  if (match) CFRelease(match);
  if (values[0]) CFRelease(values[0]);
  if (values[1]) CFRelease(values[1]);
}

int main(void) {
  int apple_silicon = 0, found = 0;
  size_t size = sizeof(apple_silicon);
  io_connect_t conn = smc_open();
  /* On an Intel Mac the Tp.. keys are the power supply, so each kind reads only its own keys. */
  if (sysctlbyname("hw.optional.arm64", &apple_silicon, &size, NULL, 0) != 0) {
    apple_silicon = 0;
  }
  if (conn) {
    found = smc_report_keys(conn, apple_silicon ? APPLE_KEYS : INTEL_KEYS);
    if (!found && apple_silicon) {
      found = smc_report_unlisted(conn);
    }
    IOServiceClose(conn);
  }
  if (!found) {
    hid_report();
  }
  return 0;
}
`
