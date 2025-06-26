import FeatureCard from "@/components/feature-card";
import {
  BotIcon,
  SparklesIcon,
  DatabaseIcon,
  ShieldIcon,
  FileTextIcon,
  ServerIcon,
  LockIcon,
  ZapIcon,
} from "@/components/feature-icons";

export default function FeaturesSection() {
  const features = [
    {
      icon: <BotIcon />,
      title: "AI-Powered Student Matching",
      description:
        "Intelligent matching system using OpenAI to connect students with the perfect teachers based on learning goals and availability.",
      accentColor: "rgba(36, 101, 237, 0.5)",
    },
    {
      icon: <SparklesIcon />,
      title: "Smart Learning Paths",
      description: "Personalized learning recommendations based on student input preferences, timing, and educational objectives.",
      accentColor: "rgba(236, 72, 153, 0.5)",
    },
    {
      icon: <DatabaseIcon />,
      title: "Dynamic Session Management",
      description: "Comprehensive database system that tracks enrolled subjects, learning paths, and automatically suggests relevant lectures.",
      accentColor: "rgba(34, 211, 238, 0.5)",
    },
    {
      icon: <ShieldIcon />,
      title: "Flexible Scheduling System",
      description: "Teachers can set multiple class schedules per week with automatic availability management and conflict resolution.",
      accentColor: "rgba(132, 204, 22, 0.5)",
    },
    {
      icon: <FileTextIcon />,
      title: "Natural Language Processing",
      description: "Students can input learning preferences in natural language, which gets converted to structured queries for optimal matching.",
      accentColor: "rgba(249, 115, 22, 0.5)",
    },
    {
      icon: <ServerIcon />,
      title: "Real-time Availability Tracking",
      description: "Live synchronization of teacher schedules and student preferences with instant updates and notifications.",
      accentColor: "rgba(168, 85, 247, 0.5)",
    },
    {
      icon: <LockIcon />,
      title: "Secure Learning Environment",
      description:
        "Protected student and teacher profiles with secure data handling and privacy-focused scheduling management.",
      accentColor: "rgba(251, 191, 36, 0.5)",
    },
    {
      icon: <ZapIcon />,
      title: "Automated Notifications",
      description: "Smart notification system that alerts students about upcoming lectures and reminds teachers of scheduled sessions.",
      accentColor: "rgba(16, 185, 129, 0.5)",
    },
  ];

  return (
    <section className="py-20 bg-muted/50 dark:bg-muted/10" id="features" aria-labelledby="features-heading">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-12">
          <div className="space-y-2">
            <div className="inline-block rounded-lg bg-primary px-3 py-1 text-sm text-primary-foreground mb-2">
              Key Features
            </div>
            <h2 id="features-heading" className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
              Intelligent Learning Scheduler
            </h2>
            <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl">
              Connecting students and teachers through AI-powered scheduling for personalized educational experiences.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <FeatureCard
              key={index}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              accentColor={feature.accentColor}
            />
          ))}
        </div>
      </div>
    </section>
  );
}