import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.HexFormat;
import java.util.List;

/** Offline signing: pass file paths only. Private keys/passwords never enter source or CI. */
public class SignApk {
    public static void main(String[] args) throws Exception {
        if (args.length != 4) throw new IllegalArgumentException("unsigned.apk signed.apk private-keystore password-file");
        char[] password = Files.readString(Path.of(args[3])).strip().toCharArray();
        KeyStore store = KeyStore.getInstance("JKS");
        try (var input = Files.newInputStream(Path.of(args[2]))) { store.load(input, password); }
        PrivateKey key = (PrivateKey) store.getKey("almox", password);
        X509Certificate certificate = (X509Certificate) store.getCertificate("almox");
        var signer = new ApkSigner.SignerConfig.Builder("almox", key, List.of(certificate)).build();
        new ApkSigner.Builder(List.of(signer)).setInputApk(new File(args[0])).setOutputApk(new File(args[1]))
            .setMinSdkVersion(26).setV1SigningEnabled(false).setV2SigningEnabled(true).setV3SigningEnabled(true)
            .setV4SigningEnabled(false).build().sign();
        java.util.Arrays.fill(password, '\0');
        var result = new ApkVerifier.Builder(new File(args[1])).setMinCheckedPlatformVersion(26).build().verify();
        if (!result.isVerified() || !result.isVerifiedUsingV2Scheme() || !result.isVerifiedUsingV3Scheme()) throw new IllegalStateException("Assinatura APK inválida.");
        String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));
        System.out.println("APK assinado e verificado (v2/v3). Certificado SHA-256: " + fingerprint);
    }
}
