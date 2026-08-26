export class LeadEntity {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  topic: string;
  interests: string;
  role: string;
  preferredLanguage: string;
  isContacted: boolean;
  contactedAt: Date | null;
  contactedByUserId: number | null;
  contactedByUser: { id: number; firstname: string; lastname: string } | null;
  createdAt: Date;

  constructor(partial: Partial<LeadEntity>) {
    Object.assign(this, partial);
  }
}
