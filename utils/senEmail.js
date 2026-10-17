const nodeMailer = require('nodemailer');
const sendEmail = async(to, subject, text) =>{
    try{
        const transporter = nodeMailer.createTransport({
            service:'Gmail',
            auth:{
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions ={
            from: process.env.EMAIL_USER,
            to,
            subject,
            text,
        };
        const result = await transporter.sendMail(mailOptions);
        const recipientAccepted = result.accepted?.some((address) => String(address).toLowerCase() === String(to).toLowerCase());
        if (!recipientAccepted) {
            throw new Error('The mail provider did not accept the recipient address');
        }
        return result;
    }
    catch(error){
        console.error('Error sending email: ', error);
        throw error;
    }
        

};

module.exports = sendEmail;