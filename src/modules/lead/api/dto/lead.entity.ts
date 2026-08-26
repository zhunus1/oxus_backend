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

  constructor(partial: Record<string, any>) {
    this.id = partial.id;
    this.firstName = partial.firstName;
    this.lastName = partial.lastName;
    this.phone = partial.phoneNumber ?? partial.phone;
    this.email = partial.email;
    this.topic = partial.topic;
    this.interests = partial.interests;
    this.role = partial.role;
    this.preferredLanguage = partial.preferredLanguage;
    this.isContacted = partial.isContacted;
    this.contactedAt = partial.contactedAt;
    this.contactedByUserId = partial.contactedByUserId;
    this.contactedByUser = partial.contactedByUser;
    this.createdAt = partial.createdAt;
  }
}
