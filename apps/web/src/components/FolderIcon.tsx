import {
  AirplaneIcon,
  BarbellIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CameraIcon,
  ChartLineIcon,
  ChatCircleIcon,
  CodeIcon,
  CurrencyDollarIcon,
  DeviceMobileIcon,
  FolderIcon as PhFolderIcon,
  ForkKnifeIcon,
  GameControllerIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  HouseIcon,
  LeafIcon,
  LightningIcon,
  MusicNotesIcon,
  PaintBrushIcon,
  RobotIcon,
  ShoppingCartIcon,
  TelegramLogoIcon,
  UsersIcon,
  WrenchIcon,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";
import type { FolderIcon as FolderIconName } from "@lightbulb/shared";

const ICONS: Record<FolderIconName, Icon> = {
  Folder: PhFolderIcon,
  Robot: RobotIcon,
  Code: CodeIcon,
  TelegramLogo: TelegramLogoIcon,
  DeviceMobile: DeviceMobileIcon,
  Globe: GlobeIcon,
  House: HouseIcon,
  Briefcase: BriefcaseIcon,
  CurrencyDollar: CurrencyDollarIcon,
  ShoppingCart: ShoppingCartIcon,
  Heart: HeartIcon,
  Barbell: BarbellIcon,
  GameController: GameControllerIcon,
  PaintBrush: PaintBrushIcon,
  Camera: CameraIcon,
  MusicNotes: MusicNotesIcon,
  BookOpen: BookOpenIcon,
  GraduationCap: GraduationCapIcon,
  Leaf: LeafIcon,
  Airplane: AirplaneIcon,
  ForkKnife: ForkKnifeIcon,
  Wrench: WrenchIcon,
  Lightning: LightningIcon,
  ChatCircle: ChatCircleIcon,
  Users: UsersIcon,
  ChartLine: ChartLineIcon,
};

export function FolderGlyph({
  name,
  size = 18,
  weight = "regular",
  className,
}: {
  name: FolderIconName;
  size?: number;
  weight?: IconWeight;
  className?: string;
}) {
  const Glyph = ICONS[name] ?? PhFolderIcon;
  return <Glyph size={size} weight={weight} className={className} aria-hidden />;
}
