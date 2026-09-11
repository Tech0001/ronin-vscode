// macOS equivalents of Linux flock(1) and /proc foreground argv lookup.
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int foreground_argv(const char *pid_string) {
  char *end;
  long pid = strtol(pid_string, &end, 10);
  if (!*pid_string || *end || pid <= 0 || pid > INT_MAX) return 1;
  int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)pid};
  struct kinfo_proc info;
  size_t size = sizeof(info);
  if (sysctl(mib, 4, &info, &size, NULL, 0) || size != sizeof(info)) return 1;
  pid_t group = info.kp_eproc.e_tpgid;
  if (group <= 0 || group == pid) return 0;

  int argmax;
  size = sizeof(argmax);
  int limit[] = {CTL_KERN, KERN_ARGMAX};
  if (sysctl(limit, 2, &argmax, &size, NULL, 0) || argmax <= 0 || argmax > 1024 * 1024) return 1;
  char *buffer = malloc((size_t)argmax);
  if (!buffer) return 1;
  int args[] = {CTL_KERN, KERN_PROCARGS2, group};
  size = (size_t)argmax;
  if (sysctl(args, 3, buffer, &size, NULL, 0) || size < sizeof(int)) { free(buffer); return 1; }
  int argc;
  memcpy(&argc, buffer, sizeof(argc));
  char *cursor = buffer + sizeof(argc), *stop = buffer + size;
  // Skip the executable path and its padding before argv[0]. Never emit env.
  char *nul = memchr(cursor, '\0', (size_t)(stop - cursor));
  if (!nul || argc <= 0) { free(buffer); return 1; }
  cursor = nul + 1;
  while (cursor < stop && !*cursor) cursor++;
  char *first = cursor;
  for (int i = 0; i < argc; i++) {
    nul = memchr(cursor, '\0', (size_t)(stop - cursor));
    if (!nul) { free(buffer); return 1; }
    cursor = nul + 1;
  }
  size_t length = (size_t)(cursor - first);
  int result = fwrite(first, 1, length, stdout) == length ? 0 : 1;
  free(buffer);
  return result;
}

int main(int argc, char **argv) {
  if (argc == 3 && !strcmp(argv[1], "foreground-argv")) return foreground_argv(argv[2]);
  if (argc < 4 || strcmp(argv[1], "lock")) return 1;
  int fd = open(argv[2], O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
  struct stat info;
  if (fd < 0 || fstat(fd, &info) || !S_ISREG(info.st_mode) || info.st_uid != getuid() || (info.st_mode & 077)) return 1;
  if (flock(fd, LOCK_EX | LOCK_NB)) return errno == EWOULDBLOCK ? 0 : 1;
  // exec retains the lock descriptor; the kernel releases it on daemon exit,
  // including crashes. Never unlink the lock file (that would allow races).
  execv(argv[3], &argv[3]);
  perror("Ronin terminal service exec");
  return 1;
}
