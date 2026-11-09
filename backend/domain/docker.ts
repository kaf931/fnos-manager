export interface ContainerPort {
  hostPort: number;
  containerPort: number;
  hostIp: string;
}
export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  ports: ContainerPort[];
  iconUrl: string;
  serviceUrl: string;
}
