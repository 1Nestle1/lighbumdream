const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
};

const time = () => c.dim(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

export const log = {
  plain: (message = "") => console.log(message),
  info: (message: string) => console.log(`${time()} ${message}`),
  step: (message: string) => console.log(`${time()} ${c.yellow("●")} ${message}`),
  ok: (message: string) => console.log(`${time()} ${c.green("✔")} ${message}`),
  warn: (message: string) => console.warn(`${time()} ${c.yellow("!")} ${message}`),
  error: (message: string) => console.error(`${time()} ${c.red("✖")} ${message}`),
  progress: (message: string) => console.log(`${time()}   ${c.dim(message)}`),
};
